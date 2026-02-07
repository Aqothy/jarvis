export const IPC_CHANNELS = {
  getPermissionStatus: "assistant:get-permission-status",
  requestMicrophonePermission: "assistant:request-microphone-permission",
  requestAccessibilityPermission: "assistant:request-accessibility-permission",
  sttStart: "assistant:stt-start",
  sttAudioChunk: "assistant:stt-audio-chunk",
  sttStop: "assistant:stt-stop",
  captureContextPreview: "assistant:capture-context-preview",
  insertTextAtCursor: "assistant:insert-text-at-cursor",
  runTextTask: "assistant:run-text-task",
  runImageTask: "assistant:run-image-task",
  pushToTalkShortcut: "assistant:push-to-talk-shortcut"
} as const;
