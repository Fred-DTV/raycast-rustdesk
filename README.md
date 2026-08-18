# RustDesk Raycast extension (Rustconnect)

Raycast command that lists RustDesk peers from your local client config, filters as you type, and connects with one action.

## Requirements

- [Raycast](https://www.raycast.com/) (macOS; Windows supported by extension metadata)
- [Node.js](https://nodejs.org/) 20+ recommended
- [RustDesk](https://rustdesk.com/) installed locally
  - macOS default binary: `/Applications/RustDesk.app/Contents/MacOS/RustDesk`
  - Windows default binary: `C:\\Program Files\\RustDesk\\rustdesk.exe`

## Install (team)

```bash
git clone <REPO_URL>
cd rustdesk
npm install
npm run dev
```

`npm run dev` starts Raycast development mode and registers the extension. Keep that terminal open while developing; for day-to-day use you can stop it after Raycast has imported the extension once, or use **Import Extension** in Raycast and point at this folder after `npm install` + `npm run build`.

### Import without keeping dev mode open

1. `npm install`
2. `npm run build`
3. Raycast → **Import Extension** → select this `rustdesk` folder

### Use

1. Open Raycast
2. Run **Rustconnect**
3. Type part of hostname / ID / username / platform
4. Enter → connects via RustDesk

**Reload Peers** action refreshes the list after new RustDesk sessions.

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
| `npm install` | Install dependencies |
| `npm run dev` | Develop / register with Raycast |
| `npm run build` | Production build |
| `npm run lint` | Lint |
| `npm run publish` | Publish to Raycast Store (org/private needs Team plan) |

## Permissions

If the peer list is empty in Raycast but peers exist on disk, Raycast may be blocked from reading the Preferences folder. Grant Raycast access (Full Disk Access or the peers path), then use **Reload Peers**.

## Security notes

- Do **not** commit or share RustDesk peer TOML files (they can contain passwords).
- Do **not** put passwords or API keys in `assets/devices.json` or the repo.
- Each teammate uses their own local RustDesk history/address book.

## Project layout

```
assets/devices.json      optional overrides
assets/extension-icon.png
src/rustconnect.tsx      List UI + search
src/loadPeers.ts         peer TOML loader (password-safe)
src/connectRustDesk.ts   launch RustDesk --connect
package.json             Raycast extension manifest
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No peers | RustDesk installed and used at least once; peers dir exists; Raycast file access |
| Connect fails | RustDesk path; try launching RustDesk manually |
| `ray: command not found` / wrong tool | Use `npm run dev` / `npm run build`, not a global `ray` |
| Stale list | Action **Reload Peers**, or reconnect once in RustDesk so a peer file is written |
