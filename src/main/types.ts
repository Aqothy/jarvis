export type ClipboardKind = "text" | "image" | "none";

export interface ActiveAppContext {
  name: string;
  windowTitle: string;
}

export interface BoundedText {
  text: string;
  truncated: boolean;
  totalChars: number;
}

export interface ClipboardContext {
  kind: ClipboardKind;
  text?: BoundedText;
  imagePath?: string;
}

export interface ContextSnapshot {
  timestamp: string;
  activeApp: ActiveAppContext;
  clipboard: ClipboardContext;
  sourceUsed: "clipboard_text" | "clipboard_image" | "none";
}

export interface TextTaskRequest {
  instruction: string;
}

export interface TextTaskResult {
  context: ContextSnapshot;
  sourceText: string;
  transformedText: string;
  inserted: boolean;
  fallbackCopiedToClipboard: boolean;
}

export interface ImageTaskRequest {
  instruction: string;
}

export interface ImageTaskResult {
  context: ContextSnapshot;
  outputImagePath: string;
}

export interface InsertTextAtCursorResult {
  inserted: boolean;
  fallbackCopiedToClipboard: boolean;
}

export interface TranscriptionResult {
  transcript: string;
}

export interface PermissionStatus {
  microphone: boolean;
  accessibility: boolean;
}

export interface AppBridge {
  getPermissionStatus: () => Promise<PermissionStatus>;
  requestMicrophonePermission: () => Promise<boolean>;
  requestAccessibilityPermission: () => Promise<boolean>;
  startSttSession: () => Promise<void>;
  pushSttAudioChunk: (audioBuffer: ArrayBuffer) => void;
  stopSttSession: () => Promise<TranscriptionResult>;
  insertTextAtCursor: (text: string) => Promise<InsertTextAtCursorResult>;
  runTextTask: (request: TextTaskRequest) => Promise<TextTaskResult>;
  runImageTask: (request: ImageTaskRequest) => Promise<ImageTaskResult>;
  captureContextPreview: () => Promise<ContextSnapshot>;
  onPushToTalkShortcut: (listener: () => void) => () => void;
}
