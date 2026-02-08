import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../main/ipc-channels";
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

/**
 * The API exposed to the React renderer.
 * 'invoke' for request-response (Promises), 'send' for fire-and-forget data streams.
 */
const api: AppBridge = {
  getPermissionStatus: (): Promise<PermissionStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.getPermissionStatus),

  requestMicrophonePermission: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.requestMicrophonePermission),

  requestAccessibilityPermission: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.requestAccessibilityPermission),

  startSttSession: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.sttStart),

  pushSttAudioChunk: (audioBuffer: ArrayBuffer): void => {
    ipcRenderer.send(IPC_CHANNELS.sttAudioChunk, audioBuffer);
  },

  stopSttSession: (): Promise<TranscriptionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.sttStop),

  captureContextPreview: (): Promise<ContextSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.captureContextPreview),

  insertTextAtCursor: (text: string): Promise<InsertTextAtCursorResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.insertTextAtCursor, text),

  runTextTask: (request: TextTaskRequest): Promise<TextTaskResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.runTextTask, request),

  runImageTask: (request: ImageTaskRequest): Promise<ImageTaskResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.runImageTask, request),

  setTtsEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.ttsSetEnabled, enabled),

  getMemoryText: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.memoryGetText),

  setMemoryText: (text: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.memorySetText, text),

  onPushToTalkShortcut: (listener: () => void): (() => void) => {
    // Strip the IPC event argument so the renderer only sees a clean callback.
    const handler = () => listener();
    ipcRenderer.on(IPC_CHANNELS.pushToTalkShortcut, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pushToTalkShortcut, handler);
  },

  onPushToTalkDictationShortcut: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on(IPC_CHANNELS.pushToTalkDictationShortcut, handler);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.pushToTalkDictationShortcut, handler);
  },
};

/**
 * Security: Use contextBridge to expose a limited set of APIs to the renderer.
 * This prevents the frontend from accessing full Node.js or Electron internals.
 */
contextBridge.exposeInMainWorld("jarvis", api);
