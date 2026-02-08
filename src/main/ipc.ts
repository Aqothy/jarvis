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
  getMemoryText,
  setMemoryText,
} from "./services/memory-service";
import { setTtsEnabled } from "./services/tts-state-service";
import {
  pushGradiumSttAudioChunk,
  startGradiumSttSession,
  stopGradiumSttSession,
} from "./services/gradium-stt-service";
import { runImageTask, runTextTask } from "./services/task-runner";
import { authenticateCalendar } from "./services/calendar-auth-helper";
import { CalendarService } from "./services/calendar-service";

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

  // STT Stream management: starts a single transcription stream on the persistent socket.
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
          audioBuffer instanceof Uint8Array ? audioBuffer.buffer : audioBuffer;
        pushGradiumSttAudioChunk(buffer as ArrayBuffer);
      } catch (err) {
        log.debug("Failed to push STT audio chunk:", err);
      }
    },
  );

  // Ends the active transcription stream and returns the final transcript.
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
    IPC_CHANNELS.ttsSetEnabled,
    async (_event, enabled: boolean): Promise<void> => {
      setTtsEnabled(enabled === true);
    },
  );

  ipcMain.handle(IPC_CHANNELS.memoryGetText, async (): Promise<string> => {
    return getMemoryText();
  });

  ipcMain.handle(
    IPC_CHANNELS.memorySetText,
    async (_event, text: string): Promise<void> => {
      setMemoryText(text);
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

  ipcMain.handle(
    IPC_CHANNELS.calendarAuthenticate,
    async (): Promise<{ success: boolean; error?: string }> => {
      return authenticateCalendar();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.calendarCheckAuth,
    async (): Promise<boolean> => {
      return CalendarService.isAuthenticated();
    },
  );
}
