import { ipcMain, systemPreferences } from "electron";
import type {
  ContextSnapshot,
  InsertTextAtCursorResult,
  ImageTaskRequest,
  ImageTaskResult,
  PermissionStatus,
  TextTaskRequest,
  TextTaskResult
} from "./types";
import { captureContextSnapshot } from "./services/context-service";
import {
  getAccessibilityPermissionStatus,
  insertTextAtCursor,
  requestAccessibilityPermission,
  writeClipboardText
} from "./services/macos-service";
import {
  pushGradiumSttAudioChunk,
  startGradiumSttSession,
  stopGradiumSttSession
} from "./services/gradium-stt-service";
import { runImageTask, runTextTask } from "./services/task-runner";

export function registerIpcHandlers(): void {
  ipcMain.handle("assistant:get-permission-status", async (): Promise<PermissionStatus> => {
    const microphone = systemPreferences.getMediaAccessStatus("microphone") === "granted";
    const accessibility = getAccessibilityPermissionStatus();
    return { microphone, accessibility };
  });

  ipcMain.handle("assistant:request-microphone-permission", async (): Promise<boolean> => {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    return granted;
  });

  ipcMain.handle("assistant:request-accessibility-permission", async (): Promise<boolean> => {
    return requestAccessibilityPermission();
  });

  ipcMain.handle("assistant:stt-start", async (): Promise<void> => {
    await startGradiumSttSession();
  });

  ipcMain.on("assistant:stt-audio-chunk", (_event, audioBuffer: ArrayBuffer | Uint8Array) => {
    try {
      const normalized =
        audioBuffer instanceof ArrayBuffer
          ? audioBuffer
          : new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength).slice().buffer;
      pushGradiumSttAudioChunk(normalized);
    } catch {
    }
  });

  ipcMain.handle("assistant:stt-stop", async (): Promise<{ transcript: string }> => {
    const transcript = await stopGradiumSttSession();
    return { transcript };
  });

  ipcMain.handle("assistant:capture-context-preview", async (): Promise<ContextSnapshot> => {
    return captureContextSnapshot();
  });

  ipcMain.handle("assistant:insert-text-at-cursor", async (_event, text: string): Promise<InsertTextAtCursorResult> => {
    if (!text || text.trim().length === 0) {
      return {
        inserted: false,
        fallbackCopiedToClipboard: false
      };
    }

    const inserted = await insertTextAtCursor(text);
    let fallbackCopiedToClipboard = false;

    if (!inserted) {
      writeClipboardText(text);
      fallbackCopiedToClipboard = true;
    }

    return {
      inserted,
      fallbackCopiedToClipboard
    };
  });

  ipcMain.handle("assistant:run-text-task", async (_event, request: TextTaskRequest): Promise<TextTaskResult> => {
    return runTextTask(request);
  });

  ipcMain.handle(
    "assistant:run-image-task",
    async (_event, request: ImageTaskRequest): Promise<ImageTaskResult> => {
      return runImageTask(request);
    }
  );
}
