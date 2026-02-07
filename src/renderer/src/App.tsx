import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextSnapshot, PermissionStatus } from "../../main/types";
import { useAudioCapture } from "./hooks/useAudioCapture";

type TaskState = "idle" | "running_text";

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

  // ---------------------------------------------------------------------------
  // Recording + task orchestration
  // ---------------------------------------------------------------------------

  const handleStartRecording = useCallback(async (): Promise<void> => {
    setError(null);

    try {
      refreshPermissions().catch(() => undefined);
      await startCapture();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to start recording.",
      );
    }
  }, [refreshPermissions, startCapture]);

  const handleStopRecording = useCallback(async (): Promise<void> => {
    try {
      const transcript = await stopCapture();
      if (!transcript) {
        return;
      }

      setTaskStateNow("running_text");
      // TODO: could be image too, need to handle image as well
      const textTaskResult = await bridge.runTextTask({
        instruction: transcript,
      });
      setContextPreview(textTaskResult.context);
      setTaskStateNow("idle");
    } catch (err) {
      setTaskStateNow("idle");
      setError(err instanceof Error ? err.message : "Task failed.");
    }
  }, [bridge, stopCapture]);

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

    const unsubscribe = bridge.onPushToTalkShortcut(() => {
      if (captureStateRef.current === "recording") {
        handleStopRecording().catch(() => undefined);
      } else if (
        captureStateRef.current === "idle" &&
        taskStateRef.current === "idle"
      ) {
        handleStartRecording().catch(() => undefined);
      }
    });

    return () => {
      unsubscribe();
      teardown({ closeContext: true }).catch(() => undefined);
    };
  }, [
    bridge,
    refreshPermissions,
    refreshContextPreview,
    handleStartRecording,
    handleStopRecording,
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
            Shortcut: <kbd>Option + Space</kbd>
          </div>
          <div className="actions">
            <button onClick={refreshPermissions}>Refresh</button>
            <button onClick={requestAccessibility}>Request Access</button>
            <button onClick={refreshContextPreview}>Refresh Preview</button>
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
