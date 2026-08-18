#!/usr/bin/env bash
# Install RustDesk Raycast extension (no lasting dev mode).
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Fred-DTV/raycast-rustdesk/main/install.sh | bash
#   ./install.sh
set -euo pipefail

REPO_URL="${RAYCAST_RUSTDESK_REPO:-https://github.com/Fred-DTV/raycast-rustdesk.git}"
INSTALL_DIR="${RAYCAST_RUSTDESK_DIR:-$HOME/.local/share/raycast-rustdesk}"
REGISTER_TIMEOUT_SEC="${RAYCAST_RUSTDESK_REGISTER_TIMEOUT:-45}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

is_repo_root() {
  [[ -f "$1/package.json" ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"rustdesk"' "$1/package.json" 2>/dev/null
}

resolve_dir() {
  # Explicit path wins
  if [[ -n "${1:-}" ]] && is_repo_root "$1"; then
    printf '%s\n' "$1"
    return
  fi

  # Running from a checked-out copy: ./install.sh
  # (skip when piped via curl | bash — BASH_SOURCE is not a real file path)
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "$src" && "$src" != "bash" && "$src" != "-" && "$src" != "/dev/stdin" && -f "$src" ]]; then
    local here
    here="$(cd "$(dirname "$src")" && pwd)"
    if is_repo_root "$here"; then
      printf '%s\n' "$here"
      return
    fi
  fi

  # Already cloned to default install dir
  if is_repo_root "$INSTALL_DIR"; then
    printf '%s\n' "$INSTALL_DIR"
    return
  fi

  printf '%s\n' "$INSTALL_DIR"
}

ensure_repo() {
  local dir="$1"
  if is_repo_root "$dir"; then
    if [[ -d "$dir/.git" ]]; then
      log "Updating $dir"
      git -C "$dir" pull --ff-only || log "git pull failed (continuing with local tree)"
    else
      log "Using local tree $dir"
    fi
    return
  fi

  need_cmd git
  mkdir -p "$(dirname "$dir")"
  if [[ -d "$dir/.git" ]]; then
    log "Updating $dir"
    git -C "$dir" pull --ff-only
  elif [[ -e "$dir" ]]; then
    die "$dir exists but is not this extension repo"
  else
    log "Cloning into $dir"
    git clone "$REPO_URL" "$dir"
  fi
}

check_prereqs() {
  need_cmd node
  need_cmd npm
  if ! command -v git >/dev/null 2>&1; then
    # git only required when cloning
    :
  fi

  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 20 ]]; then
    die "Node.js 20+ required (found $(node -v))"
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    [[ -d "/Applications/Raycast.app" ]] || die "Raycast.app not found in /Applications"
  fi
}

build_extension() {
  local dir="$1"
  cd "$dir"
  log "npm install"
  if [[ -f package-lock.json ]]; then
    npm ci --no-fund --no-audit
  else
    npm install --no-fund --no-audit
  fi

  log "Building (writes into Raycast extensions folder)"
  npx --no-install ray build -I
}

# ray develop imports the extension into Raycast, then we stop it.
# No need to leave the watcher running afterward.
register_extension() {
  local dir="$1"
  cd "$dir"

  log "Registering with Raycast (brief, then exit)"
  # Prefer local CLI from node_modules
  local ray_bin="npx --no-install ray"

  # Run develop non-interactive; stop after successful build message or timeout.
  set +e
  # shellcheck disable=SC2086
  $ray_bin develop -I >"/tmp/raycast-rustdesk-install.log" 2>&1 &
  local pid=$!
  set -e

  local waited=0
  local ok=0
  while kill -0 "$pid" 2>/dev/null; do
    if grep -Eqi 'built extension successfully|ready  - built|compiled entry points' "/tmp/raycast-rustdesk-install.log" 2>/dev/null; then
      # give Raycast a moment to import
      sleep 2
      ok=1
      break
    fi
    if grep -Eqi 'error|failed' "/tmp/raycast-rustdesk-install.log" 2>/dev/null; then
      # keep waiting a bit; build logs sometimes include recoverable noise
      :
    fi
    sleep 1
    waited=$((waited + 1))
    if [[ "$waited" -ge "$REGISTER_TIMEOUT_SEC" ]]; then
      break
    fi
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi

  if [[ "$ok" -ne 1 ]]; then
    printf 'warning: automatic register timed out or failed. Log: /tmp/raycast-rustdesk-install.log\n' >&2
    printf 'Manual fallback: open Raycast → "Import Extension" → select:\n  %s\n' "$dir" >&2
    return 1
  fi

  log "Registered"
  return 0
}

open_raycast() {
  if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open -a Raycast 2>/dev/null || true
  fi
}

main() {
  check_prereqs
  local dir
  dir="$(resolve_dir "${1:-}")"
  ensure_repo "$dir"
  is_repo_root "$dir" || die "could not find extension at $dir"
  build_extension "$dir"
  register_extension "$dir" || true
  open_raycast

  cat <<EOF

Done.
Extension path: $dir

In Raycast, run:  Rustconnect
No need to keep a terminal/dev process running.

If the command is missing:
  Raycast → Import Extension → $dir
EOF
}

main "$@"
