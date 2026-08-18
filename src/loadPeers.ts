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

function deviceFromPeer(id: string, peer: PeerInfo): Device {
  const hostname = peer.hostname?.trim() || undefined;
  const alias = peer.alias?.trim() || undefined;
  const name = alias || hostname || id;
  const keywords = [id, alias, hostname, peer.username, peer.platform]
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

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function peersPathForDisplay(): string {
  return peersDirectory();
}
