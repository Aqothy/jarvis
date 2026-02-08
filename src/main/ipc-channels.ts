export const IPC_CHANNELS = {
  getPermissionStatus: "assistant:get-permission-status",
  requestMicrophonePermission: "assistant:request-microphone-permission",
  requestAccessibilityPermission: "assistant:request-accessibility-permission",
  sttStart: "assistant:stt-start",
  sttAudioChunk: "assistant:stt-audio-chunk",
  sttStop: "assistant:stt-stop",
  captureContextPreview: "assistant:capture-context-preview",
  speechGetPreferences: "assistant:speech-get-preferences",
  ttsSetProvider: "assistant:tts-set-provider",
  ttsSetEnabled: "assistant:tts-set-enabled",
  memoryGetText: "assistant:memory-get-text",
  memorySetText: "assistant:memory-set-text",
  insertTextAtCursor: "assistant:insert-text-at-cursor",
  runTextTask: "assistant:run-text-task",
  runImageTask: "assistant:run-image-task",
  pushToTalkShortcut: "assistant:push-to-talk-shortcut",
  pushToTalkDictationShortcut: "assistant:push-to-talk-dictation-shortcut"
} as const;
