import { environment } from "@raycast/api";
import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface Device {
  name: string;
  id: string;
  keywords?: string[];
  platform?: string;
  username?: string;
  hostname?: string;
  source: "peer" | "override";
}

interface PeerInfo {
  alias?: string;
  username?: string;
  hostname?: string;
  platform?: string;
}

/** Never return or retain password/hash/key values from peer files. */
const SENSITIVE_KEY = /pass|hash|token|secret|salt|key/i;

function peersDirectory(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "RustDesk", "config", "peers");
  }

  // macOS (and Linux fallback under Preferences path used by official client)
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Preferences", "com.carriez.RustDesk", "peers");
  }

  return join(homedir(), ".config", "rustdesk", "peers");
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Minimal TOML reader for RustDesk peer files.
 * Only collects alias + [info] identity fields; skips sensitive keys.
 */
export function parsePeerToml(content: string): PeerInfo {
  const info: PeerInfo = {};
  let section = "";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim().toLowerCase();
      continue;
    }

    const eq = line.indexOf("=");
    if (eq === -1) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    if (SENSITIVE_KEY.test(key)) {
      continue;
    }

    const value = stripQuotes(line.slice(eq + 1));
    if (!value) {
      continue;
    }

    const keyLower = key.toLowerCase();
    if (!section && keyLower === "alias") {
      info.alias = value;
      continue;
    }

    if (section === "info") {
      if (keyLower === "username") info.username = value;
      if (keyLower === "hostname") info.hostname = value;
      if (keyLower === "platform") info.platform = value;
      if (keyLower === "name" && !info.alias) info.alias = value;
    }
  }

  return info;
}

function deviceFromPeer(peerFileId: string, peer: PeerInfo): Device {
  const hostname = peer.hostname?.trim() || undefined;
  const alias = peer.alias?.trim() || undefined;
  // Connect with server-canonical ID (usually UPPERCASE for named IDs).
  const id = canonicalConnectId(peerFileId);
  const name = alias || (!isNumericId(id) && !isIpLikeId(id) ? id : undefined) || hostname || id;
  const keywords = [id, peerFileId, alias, hostname, peer.username, peer.platform]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim());

  return {
    id,
    name,
    hostname,
    username: peer.username?.trim() || undefined,
    platform: peer.platform?.trim() || undefined,
    keywords: unique(keywords),
    source: "peer",
  };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Pure numeric RustDesk IDs (e.g. 1057674464) lose to named IDs (DATA3). */
function isNumericId(id: string): boolean {
  return /^\d+$/.test(id.trim());
}

function isIpLikeId(id: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(id.trim());
}

/**
 * RustDesk custom IDs are case-sensitive on the server and usually stored UPPERCASE
 * in the client UI (WRC-REMOTING3). Peer filenames on disk may use mixed case
 * (WRC-Remoting3.toml). Connecting with the wrong case fails / hits the wrong peer.
 *
 * Numeric and IP IDs are left unchanged.
 */
export function canonicalConnectId(peerFileId: string): string {
  const id = peerFileId.trim();
  if (!id) return id;
  if (isNumericId(id) || isIpLikeId(id)) {
    return id;
  }
  return id.toUpperCase();
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Only collapse true twins: same machine under a named ID + numeric/IP ID.
 * Never merge two different named IDs (WRC-Remoting2 vs WRC-Remoting3).
 */
function canDedupePair(a: Device, b: Device): boolean {
  const aNamed = !isNumericId(a.id) && !isIpLikeId(a.id);
  const bNamed = !isNumericId(b.id) && !isIpLikeId(b.id);
  // Two named IDs that are not the same id → keep both rows always
  if (aNamed && bNamed && a.id.toLowerCase() !== b.id.toLowerCase()) {
    return false;
  }

  const aHost = a.hostname ? normalizeKeyPart(a.hostname) : "";
  const bHost = b.hostname ? normalizeKeyPart(b.hostname) : "";
  if (aHost && bHost && aHost === bHost) {
    return true;
  }

  // named ID matches the other's hostname (DATA3 + hostname data3)
  if (aNamed && bHost && normalizeKeyPart(a.id) === bHost) return true;
  if (bNamed && aHost && normalizeKeyPart(b.id) === aHost) return true;

  return false;
}

/** Prefer named/custom ID over numeric/IP twin for same machine. */
function preferDevice(a: Device, b: Device): Device {
  const aWeak = isNumericId(a.id) || isIpLikeId(a.id);
  const bWeak = isNumericId(b.id) || isIpLikeId(b.id);
  if (aWeak !== bWeak) {
    return aWeak ? b : a;
  }

  // Prefer ID that matches hostname
  const host = normalizeKeyPart(a.hostname || b.hostname || "");
  if (host) {
    const aMatch = normalizeKeyPart(a.id) === host;
    const bMatch = normalizeKeyPart(b.id) === host;
    if (aMatch !== bMatch) {
      return aMatch ? a : b;
    }
  }

  // Prefer override source
  if (a.source !== b.source) {
    return a.source === "override" ? a : b;
  }

  // Prefer the id that equals display name casing-insensitively but keep original case of winner id
  if (a.id.length !== b.id.length) {
    // Prefer cleaner named id without suffix like DATA1 over DATA1-42131 when both named
    const aBase = normalizeKeyPart(a.hostname || a.name || a.id);
    const bBase = normalizeKeyPart(b.hostname || b.name || b.id);
    if (aBase && normalizeKeyPart(a.id) === aBase && normalizeKeyPart(b.id) !== bBase) return a;
    if (bBase && normalizeKeyPart(b.id) === bBase && normalizeKeyPart(a.id) !== aBase) return b;
    return a.id.length <= b.id.length ? a : b;
  }
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

function dedupeByDeviceName(devices: Device[]): Device[] {
  const result: Device[] = [];

  for (const device of devices) {
    let merged = false;
    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      if (!canDedupePair(existing, device)) {
        continue;
      }
      const winner = preferDevice(existing, device);
      const loser = winner === existing ? device : existing;
      // NEVER replace winner.id with loser.id — connect id stays peer filename of winner
      result[i] = {
        ...winner,
        id: winner.id,
        keywords: unique([...(winner.keywords ?? []), loser.id, ...(loser.keywords ?? [])]),
      };
      merged = true;
      break;
    }
    if (!merged) {
      result.push(device);
    }
  }

  return result;
}

async function loadOverrideDevices(): Promise<Device[]> {
  try {
    const path = join(environment.assetsPath, "devices.json");
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Array<{ name: string; id: string; keywords?: string[] }>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((d) => d && typeof d.id === "string" && d.id.trim())
      .map((d) => ({
        id: d.id.trim(),
        name: (d.name || d.id).trim(),
        keywords: d.keywords ?? [],
        source: "override" as const,
      }));
  } catch {
    return [];
  }
}

export async function loadDevices(): Promise<Device[]> {
  const dir = peersDirectory();
  const byId = new Map<string, Device>();
  let peerDirError: Error | undefined;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const tomls = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".toml"));

    await Promise.all(
      tomls.map(async (entry) => {
        const id = entry.name.replace(/\.toml$/i, "");
        if (!id) return;

        try {
          const content = await readFile(join(dir, entry.name), "utf8");
          const peer = parsePeerToml(content);
          byId.set(id.toLowerCase(), deviceFromPeer(id, peer));
        } catch {
          // skip unreadable peer file
        }
      }),
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      peerDirError = err;
    }
  }

  const overrides = await loadOverrideDevices();
  for (const override of overrides) {
    const key = override.id.toLowerCase();
    const existing = byId.get(key);
    if (existing) {
      byId.set(key, {
        ...existing,
        name: override.name || existing.name,
        keywords: unique([...(existing.keywords ?? []), ...(override.keywords ?? [])]),
        source: "override",
      });
    } else {
      byId.set(key, override);
    }
  }

  if (byId.size === 0 && peerDirError) {
    throw new Error(`Cannot read RustDesk peers at ${dir}: ${peerDirError.message}`);
  }

  const deduped = dedupeByDeviceName([...byId.values()]);
  return deduped.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function peersPathForDisplay(): string {
  return peersDirectory();
}

/**
 * Prefer exact Server Pro device IDs when available (authoritative casing).
 * Maps by lowercase id / hostname / name.
 */
export function applyCanonicalIdsFromApi(
  devices: Device[],
  canonicalByKey: Map<string, string> | undefined,
): Device[] {
  if (!canonicalByKey || canonicalByKey.size === 0) {
    return devices;
  }

  return devices.map((device) => {
    const keys = [device.id, device.hostname, device.name]
      .filter((v): v is string => Boolean(v && v.trim()))
      .map((v) => v.trim().toLowerCase());

    for (const key of keys) {
      const exact = canonicalByKey.get(key);
      if (exact && exact.trim()) {
        return {
          ...device,
          id: exact.trim(),
          // Keep list title aligned with the ID RustDesk shows
          name: device.source === "override" ? device.name : exact.trim(),
          keywords: unique([...(device.keywords ?? []), exact.trim(), device.id]),
        };
      }
    }
    return device;
  });
}
