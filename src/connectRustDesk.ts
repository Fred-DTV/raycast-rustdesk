import { closeMainWindow, showHUD } from "@raycast/api";
import { execFile } from "child_process";
import { platform } from "os";

const RUSTDESK_PATH_MAC = "/Applications/RustDesk.app/Contents/MacOS/RustDesk";
const RUSTDESK_PATH_WIN = "C:\\Program Files\\RustDesk\\rustdesk.exe";

function rustDeskPath(): string {
  return platform() === "win32" ? RUSTDESK_PATH_WIN : RUSTDESK_PATH_MAC;
}

export async function connectRustDesk(id: string): Promise<void> {
  const trimmed = id.trim();
  if (!trimmed) {
    await showHUD("Missing RustDesk ID");
    return;
  }

  await closeMainWindow();
  await showHUD(`Connecting to ${trimmed}…`);

  await new Promise<void>((resolve, reject) => {
    execFile(rustDeskPath(), ["--", "--connect", trimmed], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  }).catch(async (error: unknown) => {
    const message = error instanceof Error && error.message ? error.message : "Unknown error";
    await showHUD(`Failed to start RustDesk: ${message}`);
  });
}
