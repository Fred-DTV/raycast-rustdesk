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
  /** presence flags if present (rare); not the same as status */
  online?: boolean | number | string;
  is_online?: boolean | number | string;
  /**
   * Server Pro "status" is device enabled/disabled in console, NOT live presence.
   * Do not treat status===1 as online.
   */
  status?: number | string;
  last_online?: string | number;
  lastOnline?: string | number;
  last_seen?: string | number;
  info?: {
    hostname?: string;
    device_name?: string;
    username?: string;
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

/**
 * Parse Server Pro last_online.
 * Official devices.py uses UTC wall time: "%Y-%m-%dT%H:%M:%S" (no Z).
 * JS Date.parse without timezone is local — force UTC when zone missing.
 */
export function parseLastOnlineMs(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }

  const s0 = String(raw).trim();
  if (!s0) return undefined;

  if (/^\d+(\.\d+)?$/.test(s0)) {
    const n = Number(s0);
    if (!Number.isFinite(n)) return undefined;
    return n < 1e12 ? n * 1000 : n;
  }

  const m = s0.match(
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (m) {
    const base = m[1].replace(" ", "T");
    const zone = m[3];
    const iso = zone ? `${base}${zone}` : `${base}Z`;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }

  const t = Date.parse(s0);
  return Number.isNaN(t) ? undefined : t;
}

/** DB migration sentinel used by Server Pro (~2011) — not a real session. */
function isSentinelLastOnline(ms: number): boolean {
  const y = new Date(ms).getUTCFullYear();
  return y > 0 && y < 2015;
}

function offlineThresholdMs(pref: string): number {
  const minutes = Number(pref);
  const m = Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
  return m * 60 * 1000;
}

/**
 * Live presence from Server Pro device row.
 * Prefer last_online (same as official devices.py offline filter).
 * Ignore console enabled/disabled `status`.
 */
export function stateFromRow(row: DeviceRow, thresholdMs: number, nowMs: number = Date.now()): OnlineState {
  const direct = truthyOnline(row.online) ?? truthyOnline(row.is_online);
  if (direct !== undefined) {
    return direct ? "online" : "offline";
  }

  const last = parseLastOnlineMs(row.last_online ?? row.lastOnline ?? row.last_seen);
  if (last === undefined) {
    return "unknown";
  }
  if (isSentinelLastOnline(last)) {
    return "offline";
  }
  if (last > nowMs + 60_000) {
    return "unknown";
  }

  return nowMs - last <= thresholdMs ? "online" : "offline";
}

function rowKeys(row: DeviceRow): string[] {
  const keys: string[] = [];
  for (const v of [
    row.id,
    row.device_id,
    row.rid,
    row.device_name,
    row.hostname,
    row.info?.device_name,
    row.info?.hostname,
    row.name,
  ]) {
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

async function fetchDevicesPage(
  baseUrl: string,
  token: string,
  current: number,
  pageSize: number,
): Promise<{ rows: DeviceRow[]; total?: number }> {
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
  if (json && typeof json === "object" && "error" in json && (json as { error?: unknown }).error) {
    throw new Error(String((json as { error: unknown }).error));
  }

  const rows = extractRows(json);
  const total =
    json && typeof json === "object" && typeof (json as { total?: unknown }).total === "number"
      ? (json as { total: number }).total
      : undefined;

  return { rows, total };
}

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
  const nowMs = Date.now();

  try {
    while (current <= 50) {
      const page = await fetchDevicesPage(baseUrl, token, current, pageSize);
      total = page.total ?? total;

      for (const row of page.rows) {
        const state = stateFromRow(row, thresholdMs, nowMs);
        for (const key of rowKeys(row)) {
          const prev = byKey.get(key);
          if (!prev || prev === "unknown") {
            byKey.set(key, state);
            continue;
          }
          // Prefer offline over online on key collision (safer; avoids "everyone online")
          if (prev === "offline" && state === "online") {
            continue;
          }
          if (prev === "online" && state === "offline") {
            byKey.set(key, "offline");
            continue;
          }
          byKey.set(key, state);
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

export function resolveOnlineState(
  device: { id: string; name: string; hostname?: string },
  lookup: OnlineLookup | undefined,
): OnlineState {
  if (!lookup?.enabled) return "unknown";

  // Prefer exact ID match first (avoids hostname collisions)
  const idKey = device.id.trim().toLowerCase();
  if (idKey && lookup.byKey.has(idKey)) {
    return lookup.byKey.get(idKey) ?? "unknown";
  }

  const keys = [device.hostname, device.name]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim().toLowerCase());

  let best: OnlineState = "unknown";
  for (const key of keys) {
    const s = lookup.byKey.get(key);
    if (!s || s === "unknown") continue;
    if (s === "offline") return "offline";
    if (s === "online") best = "online";
  }
  return best;
}
