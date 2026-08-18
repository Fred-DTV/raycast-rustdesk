import { getPreferenceValues } from "@raycast/api";

export type OnlineState = "online" | "offline" | "unknown";

export interface OnlinePreferences {
  enableOnlineStatus: boolean;
  apiBaseUrl: string;
  apiToken: string;
  offlineAfterMinutes: string;
}

export interface OnlineLookup {
  /** keyed by lowercased device id and hostname */
  byKey: Map<string, OnlineState>;
  /** true if prefs enabled and request attempted */
  enabled: boolean;
  error?: string;
}

interface DeviceRow {
  id?: string;
  device_id?: string;
  rid?: string;
  uuid?: string;
  hostname?: string;
  device_name?: string;
  name?: string;
  online?: boolean | number | string;
  is_online?: boolean | number | string;
  status?: number | string;
  last_online?: string | number;
  lastOnline?: string | number;
  last_seen?: string | number;
  info?: {
    hostname?: string;
    device_name?: string;
  };
}

function prefs(): OnlinePreferences {
  return getPreferenceValues<OnlinePreferences>();
}

export function isOnlineStatusConfigured(): boolean {
  try {
    const p = prefs();
    return Boolean(p.enableOnlineStatus && p.apiBaseUrl?.trim() && p.apiToken?.trim());
  } catch {
    return false;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function truthyOnline(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "online", "on", "yes"].includes(v)) return true;
    if (["0", "false", "offline", "off", "no"].includes(v)) return false;
  }
  return undefined;
}

function parseLastSeenMs(row: DeviceRow): number | undefined {
  const raw = row.last_online ?? row.lastOnline ?? row.last_seen;
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "number") {
    // seconds vs ms
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== "" && /^\d+$/.test(raw.trim())) {
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? undefined : t;
}

function offlineThresholdMs(pref: string): number {
  const minutes = Number(pref);
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
  return m * 60 * 1000;
}

function stateFromRow(row: DeviceRow, thresholdMs: number): OnlineState {
  const direct = truthyOnline(row.online) ?? truthyOnline(row.is_online);
  if (direct !== undefined) {
    return direct ? "online" : "offline";
  }

  if (row.status !== undefined && row.status !== null && row.status !== "") {
    const s = String(row.status).toLowerCase();
    if (s === "1" || s === "online") return "online";
    if (s === "0" || s === "offline" || s === "2") return "offline";
    const n = Number(row.status);
    // common: 1 online, 0 offline
    if (n === 1) return "online";
    if (n === 0 || n === 2) return "offline";
  }

  const last = parseLastSeenMs(row);
  if (last !== undefined) {
    return Date.now() - last <= thresholdMs ? "online" : "offline";
  }

  return "unknown";
}

function rowKeys(row: DeviceRow): string[] {
  const keys: string[] = [];
  for (const v of [row.id, row.device_id, row.rid, row.uuid, row.hostname, row.device_name, row.name, row.info?.hostname, row.info?.device_name]) {
    if (v && String(v).trim()) {
      keys.push(String(v).trim().toLowerCase());
    }
  }
  return [...new Set(keys)];
}

function extractRows(payload: unknown): DeviceRow[] {
  if (Array.isArray(payload)) {
    return payload as DeviceRow[];
  }
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "devices", "rows", "list", "items"]) {
    const v = obj[key];
    if (Array.isArray(v)) {
      return v as DeviceRow[];
    }
    if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
      return (v as { data: DeviceRow[] }).data;
    }
  }

  return [];
}

async function fetchDevicesPage(baseUrl: string, token: string, current: number, pageSize: number): Promise<{ rows: DeviceRow[]; total?: number }> {
  const url = new URL(`${baseUrl}/api/devices`);
  url.searchParams.set("current", String(current));
  url.searchParams.set("pageSize", String(pageSize));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }

  const json: unknown = await res.json();
  const rows = extractRows(json);
  const total =
    json && typeof json === "object" && typeof (json as { total?: unknown }).total === "number"
      ? ((json as { total: number }).total)
      : undefined;

  return { rows, total };
}

/**
 * Load online map from Server Pro devices API.
 * Optional: if not configured, returns enabled:false and empty map.
 */
export async function loadOnlineLookup(): Promise<OnlineLookup> {
  let p: OnlinePreferences;
  try {
    p = prefs();
  } catch {
    return { byKey: new Map(), enabled: false };
  }

  if (!p.enableOnlineStatus) {
    return { byKey: new Map(), enabled: false };
  }

  const baseUrl = normalizeBaseUrl(p.apiBaseUrl || "");
  const token = (p.apiToken || "").trim();
  if (!baseUrl || !token) {
    return {
      byKey: new Map(),
      enabled: true,
      error: "Online status enabled but API URL or token missing (Raycast → Extensions → Rustdesk)",
    };
  }

  const thresholdMs = offlineThresholdMs(p.offlineAfterMinutes);
  const byKey = new Map<string, OnlineState>();
  const pageSize = 100;
  let current = 1;
  let total: number | undefined;

  try {
    while (current <= 50) {
      const page = await fetchDevicesPage(baseUrl, token, current, pageSize);
      total = page.total ?? total;

      for (const row of page.rows) {
        const state = stateFromRow(row, thresholdMs);
        for (const key of rowKeys(row)) {
          const prev = byKey.get(key);
          // prefer online if any key collision
          if (prev === "online") continue;
          if (state === "online" || !prev || prev === "unknown") {
            byKey.set(key, state);
          }
        }
      }

      if (page.rows.length === 0) break;
      if (total !== undefined && current * pageSize >= total) break;
      if (page.rows.length < pageSize) break;
      current += 1;
    }

    return { byKey, enabled: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { byKey: new Map(), enabled: true, error: message };
  }
}

export function resolveOnlineState(device: { id: string; name: string; hostname?: string }, lookup: OnlineLookup | undefined): OnlineState {
  if (!lookup?.enabled) return "unknown";
  const keys = [device.id, device.hostname, device.name]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim().toLowerCase());

  let best: OnlineState = "unknown";
  for (const key of keys) {
    const s = lookup.byKey.get(key);
    if (s === "online") return "online";
    if (s === "offline") best = "offline";
  }
  return best;
}
