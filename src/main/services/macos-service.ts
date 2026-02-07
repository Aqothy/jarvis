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

/**
 * macOS-specific service for window detection and text insertion
 */
export class MacOSService {
  static async getActiveAppContext(): Promise<ActiveAppContext> {
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

  static async insertTextAtCursor(text: string): Promise<boolean> {
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

  static getAccessibilityPermissionStatus(): boolean {
    if (process.platform !== "darwin") {
      return true;
    }
    return systemPreferences.isTrustedAccessibilityClient(false);
  }

  static requestAccessibilityPermission(): boolean {
    if (process.platform !== "darwin") {
      return true;
    }
    return systemPreferences.isTrustedAccessibilityClient(true);
  }

  static clipboardHasImage(): boolean {
    return !clipboard.readImage().isEmpty();
  }

  static readClipboardText(): string {
    return clipboard.readText();
  }

  static readClipboardImage(): Electron.NativeImage {
    return clipboard.readImage();
  }

  static writeClipboardText(text: string): void {
    clipboard.writeText(text);
  }

  static writeClipboardImage(image: Electron.NativeImage): void {
    clipboard.writeImage(image);
  }

  static createImageFromBuffer(buffer: Buffer): Electron.NativeImage {
    return nativeImage.createFromBuffer(buffer);
  }
}

// Export legacy functions for backward compatibility
export async function getActiveAppContext(): Promise<ActiveAppContext> {
  return MacOSService.getActiveAppContext();
}

export async function insertTextAtCursor(text: string): Promise<boolean> {
  return MacOSService.insertTextAtCursor(text);
}

export function getAccessibilityPermissionStatus(): boolean {
  return MacOSService.getAccessibilityPermissionStatus();
}

export function requestAccessibilityPermission(): boolean {
  return MacOSService.requestAccessibilityPermission();
}

export function clipboardHasImage(): boolean {
  return MacOSService.clipboardHasImage();
}

export function readClipboardText(): string {
  return MacOSService.readClipboardText();
}

export function readClipboardImage(): Electron.NativeImage {
  return MacOSService.readClipboardImage();
}

export function writeClipboardText(text: string): void {
  return MacOSService.writeClipboardText(text);
}

export function writeClipboardImage(image: Electron.NativeImage): void {
  return MacOSService.writeClipboardImage(image);
}

export function createImageFromBuffer(buffer: Buffer): Electron.NativeImage {
  return MacOSService.createImageFromBuffer(buffer);
}
