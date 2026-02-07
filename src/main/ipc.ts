import { ipcMain, systemPreferences } from "electron";
import log from "electron-log/main.js";
import type {
  ContextSnapshot,
  InsertTextAtCursorResult,
  ImageTaskRequest,
  ImageTaskResult,
  PermissionStatus,
  TextTaskRequest,
  TextTaskResult,
} from "./types";
import { IPC_CHANNELS } from "./ipc-channels";
import { captureContextSnapshot } from "./services/context-service";
import {
  getAccessibilityPermissionStatus,
  insertTextAtCursor,
  requestAccessibilityPermission,
  writeClipboardText,
} from "./services/macos-service";
import {
  pushGradiumSttAudioChunk,
  startGradiumSttSession,
  stopGradiumSttSession,
} from "./services/gradium-stt-service";
import { runImageTask, runTextTask } from "./services/task-runner";

/**
 * Registers listeners for messages coming from the Renderer process.
 * 'ipcMain.handle' corresponds to 'ipcRenderer.invoke' in the preload script.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.getPermissionStatus,
    async (): Promise<PermissionStatus> => {
      const microphone =
        systemPreferences.getMediaAccessStatus("microphone") === "granted";
      const accessibility = getAccessibilityPermissionStatus();
      return { microphone, accessibility };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.requestMicrophonePermission,
    async (): Promise<boolean> => {
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return granted;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.requestAccessibilityPermission,
    async (): Promise<boolean> => {
      return requestAccessibilityPermission();
    },
  );

  // STT Session Management: Starts the WebSocket connection to the transcription service
  ipcMain.handle(IPC_CHANNELS.sttStart, async (): Promise<void> => {
    await startGradiumSttSession();
  });

  // Receives raw audio chunks from the frontend and pushes them to the active STT session.
  // Uses 'on' (fire-and-forget) instead of 'handle' since audio streaming has no response.
  ipcMain.on(
    IPC_CHANNELS.sttAudioChunk,
    (_event, audioBuffer: ArrayBuffer | Uint8Array) => {
      try {
        const buffer =
          audioBuffer instanceof ArrayBuffer
            ? audioBuffer
            : (new Uint8Array(audioBuffer).buffer as ArrayBuffer);
        pushGradiumSttAudioChunk(buffer);
      } catch (err) {
        log.debug("Failed to push STT audio chunk:", err);
      }
    },
  );

  // Ends the session and returns the final transcript
  ipcMain.handle(
    IPC_CHANNELS.sttStop,
    async (): Promise<{ transcript: string }> => {
      const transcript = await stopGradiumSttSession();
      return { transcript };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.captureContextPreview,
    async (): Promise<ContextSnapshot> => {
      return captureContextSnapshot({ persistClipboardImage: false });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.insertTextAtCursor,
    async (_event, text: string): Promise<InsertTextAtCursorResult> => {
      if (!text || text.trim().length === 0) {
        return {
          inserted: false,
          fallbackCopiedToClipboard: false,
        };
      }

      const inserted = await insertTextAtCursor(text);
      let fallbackCopiedToClipboard = false;

      // Fallback: If accessibility-based insertion fails, copy result to clipboard
      if (!inserted) {
        writeClipboardText(text);
        fallbackCopiedToClipboard = true;
      }

      return {
        inserted,
        fallbackCopiedToClipboard,
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.runTextTask,
    async (_event, request: TextTaskRequest): Promise<TextTaskResult> => {
      return runTextTask(request);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.runImageTask,
    async (_event, request: ImageTaskRequest): Promise<ImageTaskResult> => {
      return runImageTask(request);
    },
  );
}
