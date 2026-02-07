import { clipboard, nativeImage, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ActiveAppContext } from "../types";

const execFileAsync = promisify(execFile);

/** Minimum delay (ms) after simulating Cmd+V to let the target app read the clipboard. */
const PASTE_SETTLE_MS = 120;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim();
}

export async function getActiveAppContext(): Promise<ActiveAppContext> {
  const script = `
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      set appName to name of frontApp
      try
        set windowTitle to name of front window of frontApp
      on error
        set windowTitle to ""
      end try
      return appName & "||" & windowTitle
    end tell
  `;

  try {
    const output = await runAppleScript(script);
    const [name, windowTitle] = output.split("||");
    return {
      name: name || "Unknown",
      windowTitle: windowTitle || ""
    };
  } catch {
    return {
      name: "Unknown",
      windowTitle: ""
    };
  }
}

function snapshotClipboard(): { text: string; image: Electron.NativeImage } {
  return {
    text: clipboard.readText(),
    image: clipboard.readImage()
  };
}

function restoreClipboard(snapshot: { text: string; image: Electron.NativeImage }): void {
  const hasImage = !snapshot.image.isEmpty();
  if (hasImage) {
    clipboard.write({
      text: snapshot.text,
      image: snapshot.image
    });
    return;
  }
  clipboard.writeText(snapshot.text);
}

export async function insertTextAtCursor(text: string): Promise<boolean> {
  const priorClipboard = snapshotClipboard();
  try {
    clipboard.writeText(text);
    await runAppleScript('tell application "System Events" to keystroke "v" using command down');
    // Allow the target app time to read the clipboard before we restore it.
    await delay(PASTE_SETTLE_MS);
    return true;
  } catch {
    return false;
  } finally {
    restoreClipboard(priorClipboard);
  }
}

export function getAccessibilityPermissionStatus(): boolean {
  if (process.platform !== "darwin") {
    return true;
  }
  return systemPreferences.isTrustedAccessibilityClient(false);
}

export function requestAccessibilityPermission(): boolean {
  if (process.platform !== "darwin") {
    return true;
  }
  return systemPreferences.isTrustedAccessibilityClient(true);
}

export function clipboardHasImage(): boolean {
  return !clipboard.readImage().isEmpty();
}

export function readClipboardText(): string {
  return clipboard.readText();
}

export function readClipboardImage(): Electron.NativeImage {
  return clipboard.readImage();
}

export function writeClipboardText(text: string): void {
  clipboard.writeText(text);
}

export function writeClipboardImage(image: Electron.NativeImage): void {
  clipboard.writeImage(image);
}

export function createImageFromBuffer(buffer: Buffer): Electron.NativeImage {
  return nativeImage.createFromBuffer(buffer);
}
