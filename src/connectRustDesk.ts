import { closeMainWindow, showHUD } from "@raycast/api";
import { spawn } from "child_process";
import { platform } from "os";

const RUSTDESK_PATH_MAC = "/Applications/RustDesk.app/Contents/MacOS/RustDesk";
const RUSTDESK_PATH_WIN = "C:\\Program Files\\RustDesk\\rustdesk.exe";

function rustDeskPath(): string {
  return platform() === "win32" ? RUSTDESK_PATH_WIN : RUSTDESK_PATH_MAC;
}

/**
 * Connect via the RustDesk binary with the same argv that worked before:
 *   RustDesk -- --connect <ID>
 *
 * Must be detached + unref'd. A non-detached child of the Raycast extension
 * is killed when the command tears down (~15s) and the session drops.
 *
 * Do NOT use rustdesk://ID — URL hosts are lowercased (DATA3 → data3).
 * Do NOT use `open -a … --args` alone — often only activates the app UI
 * and never delivers --connect when RustDesk is already running.
 */
function launchDetached(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args =
      platform() === "darwin"
        ? ["--", "--connect", id]
        : ["--connect", id];

    const child = spawn(rustDeskPath(), args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.on("error", (error) => {
      reject(error);
    });

    // Parent must not wait on RustDesk; unref so extension exit is free.
    child.unref();
    resolve();
  });
}

export async function connectRustDesk(id: string): Promise<void> {
  const trimmed = id.trim();
  if (!trimmed) {
    await showHUD("Missing RustDesk ID");
    return;
  }

  await closeMainWindow();
  await showHUD(`Connecting to ${trimmed}…`);

  try {
    await launchDetached(trimmed);
  } catch (error: unknown) {
    const message = error instanceof Error && error.message ? error.message : "Unknown error";
    await showHUD(`Failed to start RustDesk: ${message}`);
  }
}
