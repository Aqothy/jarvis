import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBridge,
  ContextSnapshot,
  InsertTextAtCursorResult,
  ImageTaskRequest,
  ImageTaskResult,
  PermissionStatus,
  TextTaskRequest,
  TextTaskResult,
  TranscriptionResult,
} from "../main/types";

const api: AppBridge = {
  getPermissionStatus: async (): Promise<PermissionStatus> => {
    return ipcRenderer.invoke("assistant:get-permission-status");
  },
  requestMicrophonePermission: async (): Promise<boolean> => {
    return ipcRenderer.invoke("assistant:request-microphone-permission");
  },
  requestAccessibilityPermission: async (): Promise<boolean> => {
    return ipcRenderer.invoke("assistant:request-accessibility-permission");
  },
  startSttSession: async (): Promise<void> => {
    await ipcRenderer.invoke("assistant:stt-start");
  },
  pushSttAudioChunk: (audioBuffer: ArrayBuffer): void => {
    ipcRenderer.send("assistant:stt-audio-chunk", audioBuffer);
  },
  stopSttSession: async (): Promise<TranscriptionResult> => {
    return ipcRenderer.invoke("assistant:stt-stop");
  },
  captureContextPreview: async (): Promise<ContextSnapshot> => {
    return ipcRenderer.invoke("assistant:capture-context-preview");
  },
  insertTextAtCursor: async (text: string): Promise<InsertTextAtCursorResult> => {
    return ipcRenderer.invoke("assistant:insert-text-at-cursor", text);
  },
  runTextTask: async (request: TextTaskRequest): Promise<TextTaskResult> => {
    return ipcRenderer.invoke("assistant:run-text-task", request);
  },
  runImageTask: async (request: ImageTaskRequest): Promise<ImageTaskResult> => {
    return ipcRenderer.invoke("assistant:run-image-task", request);
  },
  onPushToTalkShortcut: (listener: () => void): (() => void) => {
    const eventName = "assistant:push-to-talk-shortcut";
    const wrapped = () => listener();
    ipcRenderer.on(eventName, wrapped);
    return () => {
      ipcRenderer.removeListener(eventName, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("jarvis", api);
