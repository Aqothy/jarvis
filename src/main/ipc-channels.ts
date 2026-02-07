export const IPC_CHANNELS = {
  getPermissionStatus: "assistant:get-permission-status",
  requestMicrophonePermission: "assistant:request-microphone-permission",
  requestAccessibilityPermission: "assistant:request-accessibility-permission",
  sttStart: "assistant:stt-start",
  sttAudioChunk: "assistant:stt-audio-chunk",
  sttStop: "assistant:stt-stop",
  captureContextPreview: "assistant:capture-context-preview",
  memoryList: "assistant:memory-list",
  memoryCreate: "assistant:memory-create",
  memoryUpdate: "assistant:memory-update",
  memoryDelete: "assistant:memory-delete",
  insertTextAtCursor: "assistant:insert-text-at-cursor",
  runTextTask: "assistant:run-text-task",
  runImageTask: "assistant:run-image-task",
  pushToTalkShortcut: "assistant:push-to-talk-shortcut",
  pushToTalkDictationShortcut: "assistant:push-to-talk-dictation-shortcut"
} as const;
