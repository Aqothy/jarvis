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
        err instanceof Error
          ? err.message
          : "Unable to start recording.",
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
      const textTaskResult = await bridge.runTextTask({
        instruction: transcript,
      });
      setContextPreview(textTaskResult.context);
      setTaskStateNow("idle");
    } catch (err) {
      setTaskStateNow("idle");
      setError(
        err instanceof Error ? err.message : "Task failed.",
      );
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
  }, [bridge, refreshPermissions, refreshContextPreview, handleStartRecording, handleStopRecording, teardown]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="app-shell settings-shell">
      <section className="panel">
        <h2>Permissions</h2>
        <p>Microphone: {permissions.microphone ? "granted" : "missing"}</p>
        <p>
          Accessibility: {permissions.accessibility ? "granted" : "missing"}
        </p>
        <p className="mono">
          Shortcut: Option+Space (
          {captureState === "recording" ? "recording" : displayState})
        </p>
        <div className="button-row">
          <button onClick={refreshPermissions}>Refresh</button>
          <button onClick={requestAccessibility}>Request Accessibility</button>
          <button onClick={refreshContextPreview}>
            Refresh Context Snapshot
          </button>
        </div>
      </section>

      {error && (
        <section className="panel error">
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      )}

      <section className="panel">
        <h2>Context Snapshot</h2>
        <pre>
          {contextPreview
            ? JSON.stringify(contextPreview, null, 2)
            : "No context captured yet."}
        </pre>
      </section>
    </main>
  );
}
