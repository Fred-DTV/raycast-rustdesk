# RustDesk Raycast extension (Rustconnect)

Raycast command that lists RustDesk peers from your local client config, filters as you type, and connects with one action.

## Requirements

- [Raycast](https://www.raycast.com/) (macOS; Windows supported by extension metadata)
- [Node.js](https://nodejs.org/) 20+ recommended
- [RustDesk](https://rustdesk.com/) installed locally
  - macOS default binary: `/Applications/RustDesk.app/Contents/MacOS/RustDesk`
  - Windows default binary: `C:\\Program Files\\RustDesk\\rustdesk.exe`

[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=edge_case&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://www.buymeacoffee.com/edge_case)

## Install (one command)

Needs: Raycast, Node.js 20+, git, RustDesk.

```bash
curl -fsSL https://raw.githubusercontent.com/Fred-DTV/raycast-rustdesk/main/install.sh | bash
```

What it does:

1. Clones/updates into `~/.local/share/raycast-rustdesk`
2. `npm ci` + production `ray build` (no permanent watcher)
3. Briefly registers the extension with Raycast, then exits

After that, open Raycast → **Rustconnect**. No terminal left running.

Re-run the same command to update.

### Already cloned?

```bash
./install.sh
# or
npm run install:raycast
```

### Manual fallback

If the command does not appear:

1. Raycast → **Import Extension**
2. Select `~/.local/share/raycast-rustdesk` (or your clone path)

### Use

1. Open Raycast
2. Run **Rustconnect**
3. Type part of hostname / ID / username / platform
4. Enter → connects via RustDesk

**Reload Peers** action refreshes the list after new RustDesk sessions.

## Optional online status (Server Pro API)

**Off by default.** Local peer list works without any server API.

When enabled, Rustconnect shows **Online** / **Offline** tags from your RustDesk Server Pro devices API and sorts online devices first.

### Before you enable it (admin / once per team)

1. Open the **Server Pro web console** (default port `21114`, or your HTTPS URL).
2. Sign in as an administrator.
3. Go to **Settings → Tokens → Create**.
4. Grant at least **Device** permission (read is enough for online status).
5. Create the token and **copy it immediately** (it is shown once).
6. Note the **API base URL** clients already use as `api-server`
   (example: `https://rustdesk.YOURCOMPANY.com` — **no** `/api` suffix, no token in the URL).

Optional but recommended:

- Use a **dedicated token** only for Raycast (easier to revoke).
- Prefer **Device read-only** if your console allows scoping that way.
- Do **not** paste the token into Slack/git/README.

### Enable on each Mac (after install)

1. Raycast → **Extensions** → **Rustdesk** → open preferences
   (or run **Rustconnect** → `⌘ ,` if bound to command preferences).
2. Check **Show online/offline from Server Pro API**.
3. Set **API base URL** (e.g. `https://rustdesk.YOURCOMPANY.com`).
4. Paste **API token** (password field; stored by Raycast on this machine only).
5. Optional: **Offline after (minutes)** — used when the API only exposes last-seen timestamps (default `10`).
6. Run **Rustconnect** → **Reload Peers**.

During `./install.sh` on an interactive terminal you can choose `y` to print these steps. Non-interactive curl installs skip the prompt; run:

```bash
./install.sh --online-help
```

### Behaviour notes

- Device rows still come from **local** `peers/*.toml` (deduped by name).
- Online flags are merged from `/api/devices` using id / hostname matches.
- If the API call fails, the list still works; a warning row explains the error.
- No token is written by `install.sh` and none belongs in this repository.

## How the device list is built

Peers are read live from the local RustDesk config (no manual inventory required):

| OS | Path |
| --- | --- |
| macOS | `~/Library/Preferences/com.carriez.RustDesk/peers/*.toml` |
| Windows | `%APPDATA%\\RustDesk\\config\\peers\\*.toml` |
| Linux | `~/.config/rustdesk/peers/*.toml` |

For each peer file:

- **ID** = filename (without `.toml`)
- **Name** = alias → hostname → ID
- Keywords include username / platform for search

Password / hash / key fields are **never** imported.

Optional extras or renames: edit `assets/devices.json`:

```json
[
  { "name": "Friendly Name", "id": "REAL-ID", "keywords": ["alias"] }
]
```

Empty array `[]` is fine.

## Scripts

Run from this directory. Prefer npm scripts so you do not hit an unrelated `ray` binary on PATH.

| Command | Purpose |
| --- | --- |
| `npm run install:raycast` | One-shot install/update (preferred) |
| `npm install` | Install dependencies only |
| `npm run build` | Production build into Raycast |
| `npm run dev` | Live reload while hacking on the extension |
| `npm run lint` | Lint |
| `npm run publish` | Publish to Raycast Store (org/private needs Team plan) |

## Permissions

If the peer list is empty in Raycast but peers exist on disk, Raycast may be blocked from reading the Preferences folder. Grant Raycast access (Full Disk Access or the peers path), then use **Reload Peers**.

## Security notes

- Do **not** commit or share RustDesk peer TOML files (they can contain passwords).
- Do **not** put passwords or API keys in `assets/devices.json` or the repo.
- Store Server Pro API tokens only in **Raycast preferences** (password field).
- Each teammate uses their own local RustDesk history/address book.

## Project layout

```
assets/devices.json      optional overrides
assets/extension-icon.png
src/rustconnect.tsx      List UI + search
src/loadPeers.ts         peer TOML loader (password-safe)
src/onlineStatus.ts      optional Server Pro online lookup
src/connectRustDesk.ts   launch RustDesk --connect
package.json             Raycast extension manifest + preferences
install.sh               one-command install (+ optional online help)
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No peers | RustDesk installed and used at least once; peers dir exists; Raycast file access |
| Connect fails | RustDesk path; try launching RustDesk manually |
| `ray: command not found` / wrong tool | Use `npm run install:raycast` / `npm run build`, not a global `ray` |
| Command missing after install | Raycast → Import Extension → install folder; ensure Raycast is signed in |
| Stale list | Action **Reload Peers**, or reconnect once in RustDesk so a peer file is written |
| No Online/Offline tags | Preference disabled, or token/URL empty — see “Optional online status” |
| “Online status unavailable” | Token/URL wrong, token missing Device permission, or API host unreachable |
