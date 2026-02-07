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

interface CaptureContextOptions {
  persistClipboardImage?: boolean;
}

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

function buildClipboardContext(params: {
  clipboardText: string;
  hasImage: boolean;
  clipboardImagePath?: string;
}): ClipboardContext {
  if (params.hasImage) {
    return {
      kind: "image",
      imagePath: params.clipboardImagePath
    };
  }

  if (params.clipboardText.trim().length > 0) {
    return {
      kind: "text",
      text: boundText(params.clipboardText)
    };
  }

  return {
    kind: "none"
  };
}

export async function captureContextSnapshot(options?: CaptureContextOptions): Promise<ContextSnapshot> {
  const activeAppPromise = getActiveAppContext();
  const clipboardText = readClipboardText();
  const clipboardImage = readClipboardImage();
  const hasImage = !clipboardImage.isEmpty();
  const clipboardImagePath =
    hasImage && options?.persistClipboardImage
      ? await saveClipboardImageToDisk(clipboardImage)
      : undefined;
  const activeApp = await activeAppPromise;

  const clipboard = buildClipboardContext({
    clipboardText,
    hasImage,
    clipboardImagePath
  });
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
