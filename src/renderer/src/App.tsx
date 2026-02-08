import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContextSnapshot,
  PermissionStatus,
} from "../../main/types";
import { useAudioCapture } from "./hooks/useAudioCapture";

type TaskState = "idle" | "running_text";
type RecordingMode = "auto" | "force_dictation";

const INITIAL_PERMISSIONS: PermissionStatus = {
  microphone: false,
  accessibility: false,
};

export function App(): React.ReactElement {
  const bridge = window.jarvis;

  const [permissions, setPermissions] =
    useState<PermissionStatus>(INITIAL_PERMISSIONS);
  const [contextPreview, setContextPreview] = useState<ContextSnapshot | null>(
    null,
  );
  const [taskState, setTaskState] = useState<TaskState>("idle");
  const taskStateRef = useRef<TaskState>("idle");
  const recordingModeRef = useRef<RecordingMode>("auto");
  const [memoryText, setMemoryText] = useState<string>("");
  const [memoryBusy, setMemoryBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { captureState, captureStateRef, startCapture, stopCapture, teardown } =
    useAudioCapture(bridge);

  // Derive the display state from capture + task states.
  const displayState = error
    ? "error"
    : captureState !== "idle"
      ? captureState
      : taskState;

  function setTaskStateNow(next: TaskState): void {
    taskStateRef.current = next;
    setTaskState(next);
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  const refreshPermissions = useCallback(async (): Promise<void> => {
    const status = await bridge.getPermissionStatus();
    setPermissions(status);
  }, [bridge]);

  const requestAccessibility = useCallback(async (): Promise<void> => {
    const granted = await bridge.requestAccessibilityPermission();
    if (!granted) {
      setError(
        "Accessibility permission is required for reliable cursor insertion.",
      );
    }
    const status = await bridge.getPermissionStatus();
    setPermissions(status);
  }, [bridge]);

  // ---------------------------------------------------------------------------
  // Context preview
  // ---------------------------------------------------------------------------

  const refreshContextPreview = useCallback(async (): Promise<void> => {
    try {
      const snapshot = await bridge.captureContextPreview();
      setContextPreview(snapshot);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to capture context preview.",
      );
    }
  }, [bridge]);

  const refreshMemories = useCallback(async (): Promise<void> => {
    try {
      const text = await bridge.getMemoryText();
      setMemoryText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories.");
    }
  }, [bridge]);

  const handleSaveMemoryText = useCallback(async (): Promise<void> => {
    setMemoryBusy(true);
    try {
      await bridge.setMemoryText(memoryText);
      await refreshMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory.");
    } finally {
      setMemoryBusy(false);
    }
  }, [bridge, memoryText, refreshMemories]);

  // ---------------------------------------------------------------------------
  // Recording + task orchestration
  // ---------------------------------------------------------------------------

  const handleStartRecording = useCallback(
    async (mode: RecordingMode): Promise<void> => {
      recordingModeRef.current = mode;
      setError(null);

      try {
        refreshPermissions().catch(() => undefined);
        await startCapture();
      } catch (err) {
        recordingModeRef.current = "auto";
        setError(
          err instanceof Error ? err.message : "Unable to start recording.",
        );
      }
    },
    [refreshPermissions, startCapture],
  );

  const handleStopRecording = useCallback(async (): Promise<void> => {
    const mode = recordingModeRef.current;
    recordingModeRef.current = "auto";

    try {
      const transcript = await stopCapture();
      if (!transcript) {
        return;
      }

      setTaskStateNow("running_text");
      // TODO: could be image too, need to handle image as well
      const textTaskResult = await bridge.runTextTask({
        instruction: transcript,
        mode,
      });
      setContextPreview(textTaskResult.context);
      setTaskStateNow("idle");
    } catch (err) {
      setTaskStateNow("idle");
      setError(err instanceof Error ? err.message : "Task failed.");
    }
  }, [bridge, refreshMemories, stopCapture]);

  const handlePushToTalk = useCallback(
    async (mode: RecordingMode): Promise<void> => {
      if (captureStateRef.current === "recording") {
        await handleStopRecording();
        return;
      }

      if (captureStateRef.current === "idle" && taskStateRef.current === "idle") {
        await handleStartRecording(mode);
      }
    },
    [captureStateRef, handleStartRecording, handleStopRecording],
  );

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!bridge) {
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

    refreshPermissions().catch(() => undefined);
    refreshContextPreview().catch(() => undefined);
    refreshMemories().catch(() => undefined);

    const unsubscribePushToTalk = bridge.onPushToTalkShortcut(() => {
      handlePushToTalk("auto").catch(() => undefined);
    });
    const unsubscribeDictationPushToTalk = bridge.onPushToTalkDictationShortcut(
      () => {
        handlePushToTalk("force_dictation").catch(() => undefined);
      },
    );

    return () => {
      unsubscribePushToTalk();
      unsubscribeDictationPushToTalk();
      teardown({ closeContext: true }).catch(() => undefined);
    };
  }, [
    bridge,
    refreshPermissions,
    refreshContextPreview,
    refreshMemories,
    handlePushToTalk,
    teardown,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="app-shell">
      <div className="container">
        <header>
          <h1>Jarvis</h1>
          <div className="status-badge" data-state={displayState}>
            {displayState === "recording" ? "● Recording" : displayState}
          </div>
        </header>

        <section className="permissions">
          <div className="permission-item">
            <span>Microphone</span>
            <span className={permissions.microphone ? "granted" : "missing"}>
              {permissions.microphone ? "Granted" : "Missing"}
            </span>
          </div>
          <div className="permission-item">
            <span>Accessibility</span>
            <span className={permissions.accessibility ? "granted" : "missing"}>
              {permissions.accessibility ? "Granted" : "Missing"}
            </span>
          </div>
          <div className="shortcut-hint">
            Auto: <kbd>Option + Space</kbd> | Dictation Only:{" "}
            <kbd>Option + Shift + Space</kbd>
          </div>
          <div className="actions">
            <button onClick={refreshPermissions}>Refresh</button>
            <button onClick={requestAccessibility}>Request Access</button>
            <button onClick={refreshContextPreview}>Refresh Preview</button>
          </div>
        </section>

        <section className="memory-panel">
          <h3>Memory</h3>
          <p className="memory-hint">
            One fact per line. Jarvis uses these lines as user memory context.
          </p>

          <div className="memory-create">
            <textarea
              value={memoryText}
              onChange={(event) => setMemoryText(event.target.value)}
              placeholder={"name is anthony\ndog called buns\nfriend called jason"}
              rows={8}
            />
            <div className="memory-create-controls">
              <button disabled={memoryBusy} onClick={handleSaveMemoryText}>
                Save Memory
              </button>
              <button disabled={memoryBusy} onClick={refreshMemories}>
                Reload
              </button>
            </div>
          </div>
        </section>

        {error && (
          <section className="error-box">
            <p>{error}</p>
          </section>
        )}

        <section className="preview">
          <h3>Context Snapshot</h3>
          <pre>
            {contextPreview
              ? JSON.stringify(contextPreview, null, 2)
              : "No context captured."}
          </pre>
        </section>
      </div>
    </main>
  );
}
