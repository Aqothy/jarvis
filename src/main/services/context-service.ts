import { app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { boundText, pickSourceUsed } from "../domain/context";
import type { ClipboardContext, ContextSnapshot } from "../types";
import {
  getActiveAppContext,
  readClipboardImage,
  readClipboardText
} from "./macos-service";

function getArtifactDir(): string {
  return join(app.getPath("userData"), "artifacts");
}

async function ensureArtifactDir(): Promise<void> {
  await mkdir(getArtifactDir(), { recursive: true });
}

async function saveClipboardImageToDisk(image: Electron.NativeImage): Promise<string | undefined> {
  if (image.isEmpty()) {
    return undefined;
  }

  await ensureArtifactDir();
  const png = image.toPNG();
  const filePath = join(getArtifactDir(), `clipboard-${Date.now()}-${randomUUID()}.png`);
  await writeFile(filePath, png);
  return filePath;
}

function buildClipboardContext(clipboardText: string, clipboardImagePath?: string): ClipboardContext {
  if (clipboardImagePath) {
    return {
      kind: "image",
      imagePath: clipboardImagePath
    };
  }

  if (clipboardText.trim().length > 0) {
    return {
      kind: "text",
      text: boundText(clipboardText)
    };
  }

  return {
    kind: "none"
  };
}

export async function captureContextSnapshot(): Promise<ContextSnapshot> {
  const activeAppPromise = getActiveAppContext();
  const clipboardText = readClipboardText();
  const clipboardImage = readClipboardImage();
  const clipboardImagePath = await saveClipboardImageToDisk(clipboardImage);
  const activeApp = await activeAppPromise;

  const clipboard = buildClipboardContext(clipboardText, clipboardImagePath);
  const sourceUsed = pickSourceUsed({
    clipboardKind: clipboard.kind,
    clipboardText
  });

  return {
    timestamp: new Date().toISOString(),
    activeApp,
    clipboard,
    sourceUsed
  };
}
