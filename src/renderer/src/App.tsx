import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  OverlayPayload,
  PermissionStatus,
  SpeechProvider,
} from "../../main/types";
import { useAudioCapture } from "./hooks/useAudioCapture";
import {
  Sparkles,
  Shield,
  Keyboard,
  Brain,
  CalendarDays,
  Volume2,
  Mic,
  ArrowRight,
  Circle,
  XCircle,
  Check,
  Copy,
} from "lucide-react";

type WindowMode = "settings" | "pill" | "overlay";
type TaskState = "idle" | "running_text";
type RecordingMode = "auto" | "force_dictation";
type DisplayState =
  | "idle"
  | "recording"
  | "transcribing"
  | "running_text"
  | "error";

const INITIAL_PERMISSIONS: PermissionStatus = {
  microphone: false,
  accessibility: false,
};

const WAVE_BAR_COUNT = 16;
const WAVE_BAR_BASELINE_HEIGHT = 4;
const WAVE_BAR_MAX_HEIGHT = 28;
const WAVE_BAR_PROFILE: readonly number[] = [
  0.45, 0.58, 0.72, 0.86, 0.96, 1, 0.92, 0.8,
  0.8, 0.92, 1, 0.96, 0.86, 0.72, 0.58, 0.45,
];

function useAutoClearError(
  error: string | null,
  setError: Dispatch<SetStateAction<string | null>>,
): void {
  useEffect(() => {
    if (!error) {
      return;
    }

    const timeout = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [error, setError]);
}

function getWindowMode(): WindowMode {
  const hash = window.location.hash.toLowerCase();
  if (hash.includes("overlay")) {
    return "overlay";
  }
  if (hash.includes("pill")) {
    return "pill";
  }
  return "settings";
}

export function App(): React.ReactElement {
  const mode = getWindowMode();

  useEffect(() => {
    document.body.dataset.windowMode = mode;
    return () => {
      document.body.removeAttribute("data-window-mode");
    };
  }, [mode]);

  if (mode === "pill") {
    return <PillWindow />;
  }

  if (mode === "overlay") {
    return <ResponseOverlayWindow />;
  }

  return <SettingsWindow />;
}

function SettingsWindow(): React.ReactElement {
  const bridge = window.jarvis;

  const [permissions, setPermissions] =
    useState<PermissionStatus>(INITIAL_PERMISSIONS);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(false);
  const [ttsProvider, setTtsProviderValue] =
    useState<SpeechProvider>("gradium");
  const [memoryText, setMemoryText] = useState<string>("");
  const [memoryBusy, setMemoryBusy] = useState<boolean>(false);
  const [calendarAuthenticated, setCalendarAuthenticated] =
    useState<boolean>(false);
  const [calendarAuthBusy, setCalendarAuthBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPermissions = useCallback(async (): Promise<void> => {
    const status = await bridge.getPermissionStatus();
    setPermissions(status);
  }, [bridge]);

  const requestPermissions = useCallback(async (): Promise<void> => {
    try {
      const microphoneGranted = await bridge.requestMicrophonePermission();
      const accessibilityGranted = await bridge.requestAccessibilityPermission();

      if (!microphoneGranted || !accessibilityGranted) {
        setError(
          "Microphone and Accessibility permissions are required for voice input.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to request permissions.",
      );
    }

    await refreshPermissions();
  }, [bridge, refreshPermissions]);

  const refreshMemories = useCallback(async (): Promise<void> => {
    try {
      const text = await bridge.getMemoryText();
      setMemoryText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories.");
    }
  }, [bridge]);

  const refreshCalendarAuthStatus = useCallback(async (): Promise<void> => {
    try {
      const isAuthenticated = await bridge.calendarCheckAuth();
      setCalendarAuthenticated(isAuthenticated);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to check calendar authentication.",
      );
    }
  }, [bridge]);

  const refreshSpeechPreferences = useCallback(async (): Promise<void> => {
    try {
      const preferences = await bridge.getSpeechPreferences();
      setTtsProviderValue(preferences.ttsProvider);
      setTtsEnabled(preferences.ttsEnabled);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load speech preferences.",
      );
    }
  }, [bridge]);

  const handleTtsProviderToggle = useCallback(
    async (provider: SpeechProvider): Promise<void> => {
      const previous = ttsProvider;
      setTtsProviderValue(provider);
      try {
        await bridge.setTtsProvider(provider);
      } catch (err) {
        setTtsProviderValue(previous);
        setError(
          err instanceof Error ? err.message : "Failed to set TTS provider.",
        );
      }
    },
    [bridge, ttsProvider],
  );

  const handleTtsToggle = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const nextValue = event.target.checked;
      setTtsEnabled(nextValue);
      try {
        await bridge.setTtsEnabled(nextValue);
      } catch (err) {
        setTtsEnabled(!nextValue);
        setError(
          err instanceof Error ? err.message : "Failed to save settings.",
        );
      }
    },
    [bridge],
  );

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

  const handleCalendarAuthenticate = useCallback(async (): Promise<void> => {
    setCalendarAuthBusy(true);
    try {
      const authResult = await bridge.calendarAuthenticate();
      if (!authResult.success) {
        setCalendarAuthenticated(false);
        setError(authResult.error || "Calendar authentication failed.");
        return;
      }

      await refreshCalendarAuthStatus();
    } catch (err) {
      setCalendarAuthenticated(false);
      setError(
        err instanceof Error
          ? err.message
          : "Calendar authentication failed.",
      );
    } finally {
      setCalendarAuthBusy(false);
    }
  }, [bridge, refreshCalendarAuthStatus]);

  useAutoClearError(error, setError);

  useEffect(() => {
    if (!bridge) {
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

    refreshPermissions().catch(() => undefined);
    refreshMemories().catch(() => undefined);
    refreshCalendarAuthStatus().catch(() => undefined);
    refreshSpeechPreferences().catch(() => undefined);
  }, [
    bridge,
    refreshCalendarAuthStatus,
    refreshMemories,
    refreshPermissions,
    refreshSpeechPreferences,
  ]);

  return (
    <main className="app-shell app-shell-settings">
      <div className="settings-page">
        <header className="page-header">
          <div className="logo-section">
            <div className="logo-icon">
              <Sparkles size={20} />
            </div>
            <div className="logo-text">
              <h1>Jarvis</h1>
              <span className="version">v0.1.0</span>
            </div>
          </div>
        </header>

        <div className="settings-grid">
          <section className="card">
            <div className="card-header">
              <div className="card-icon">
                <Shield size={16} />
              </div>
              <h2>Permissions</h2>
            </div>

            <div className="card-content">
              <div className="permission-item">
                <div className="permission-info">
                  <span className="permission-name">Microphone</span>
                  <span className="permission-desc">Voice input capture</span>
                </div>
                <span
                  className={`status-badge ${permissions.microphone ? "granted" : "missing"}`}
                >
                  {permissions.microphone ? "Granted" : "Missing"}
                </span>
              </div>

              <div className="permission-item">
                <div className="permission-info">
                  <span className="permission-name">Accessibility</span>
                  <span className="permission-desc">
                    Text insertion at cursor
                  </span>
                </div>
                <span
                  className={`status-badge ${permissions.accessibility ? "granted" : "missing"}`}
                >
                  {permissions.accessibility ? "Granted" : "Missing"}
                </span>
              </div>

              {(!permissions.microphone || !permissions.accessibility) && (
                <button className="btn-grant" onClick={requestPermissions}>
                  <span>Grant Permissions</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div className="card-icon">
                <Keyboard size={16} />
              </div>
              <h2>Shortcuts</h2>
            </div>

            <div className="card-content">
              <div className="shortcut-item">
                <span className="shortcut-name">Voice Command</span>
                <div className="keys">
                  <kbd>Option</kbd>
                  <span className="key-separator">+</span>
                  <kbd>Space</kbd>
                </div>
              </div>

              <div className="shortcut-item">
                <span className="shortcut-name">Dictation Only</span>
                <div className="keys">
                  <kbd>Option</kbd>
                  <span className="key-separator">+</span>
                  <kbd>Shift</kbd>
                  <span className="key-separator">+</span>
                  <kbd>Space</kbd>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div className="card-icon">
                <CalendarDays size={16} />
              </div>
              <h2>Google Calendar</h2>
            </div>

            <div className="card-content">
              <div className="permission-item">
                <div className="permission-info">
                  <span className="permission-name">Authentication</span>
                  <span className="permission-desc">
                    Read-only access for event listing
                  </span>
                </div>
                <span
                  className={`status-badge ${calendarAuthenticated ? "granted" : "missing"}`}
                >
                  {calendarAuthenticated ? "Connected" : "Not Connected"}
                </span>
              </div>
              <button
                className="btn-grant"
                disabled={calendarAuthBusy}
                onClick={() => {
                  handleCalendarAuthenticate().catch(() => undefined);
                }}
              >
                <span>
                  {calendarAuthBusy
                    ? "Opening OAuth..."
                    : calendarAuthenticated
                      ? "Re-authenticate"
                      : "Connect Google Calendar"}
                </span>
                <ArrowRight size={14} />
              </button>
            </div>
          </section>

          <section className="card card-wide">
            <div className="card-header">
              <div className="card-icon">
                <Mic size={16} />
              </div>
              <h2>Speech Providers</h2>
            </div>

            <div className="card-content">
              <div className="provider-group">
                <span className="provider-label">Text-to-Speech</span>
                <div className="provider-row">
                  <span className="toggle-title">Gradium</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={ttsProvider === "gradium"}
                      onChange={(event) => {
                        if (event.target.checked) {
                          handleTtsProviderToggle("gradium").catch(
                            () => undefined,
                          );
                        }
                      }}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
                <div className="provider-row">
                  <span className="toggle-title">ElevenLabs</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={ttsProvider === "elevenlabs"}
                      onChange={(event) => {
                        if (event.target.checked) {
                          handleTtsProviderToggle("elevenlabs").catch(
                            () => undefined,
                          );
                        }
                      }}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className="card card-wide">
            <div className="card-header">
              <div className="card-icon">
                <Volume2 size={16} />
              </div>
              <h2>Voice Output</h2>
            </div>

            <div className="card-content">
              <div className="toggle-row">
                <div className="toggle-copy">
                  <span className="toggle-title">Speak responses</span>
                  <span className="toggle-desc">
                    Replaces response overlay output with the selected TTS provider.
                  </span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={ttsEnabled}
                    onChange={handleTtsToggle}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            </div>
          </section>

          <section className="card card-wide">
            <div className="card-header">
              <div className="card-icon">
                <Brain size={16} />
              </div>
              <h2>Memory</h2>
            </div>

            <div className="card-content">
              <p className="card-desc">
                Personal context Jarvis remembers across sessions. One fact per
                line.
              </p>
              <textarea
                value={memoryText}
                onChange={(event) => setMemoryText(event.target.value)}
                placeholder={
                  "name is anthony\ndog called buns\nfriend called jason"
                }
                rows={4}
              />
              <div className="card-actions">
                <button
                  className="btn-secondary"
                  disabled={memoryBusy}
                  onClick={refreshMemories}
                >
                  Reload
                </button>
                <button
                  className="btn-primary"
                  disabled={memoryBusy}
                  onClick={handleSaveMemoryText}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className={`error-toast ${error ? "visible" : ""}`}>{error}</div>
    </main>
  );
}

function ResponseOverlayWindow(): React.ReactElement {
  const bridge = window.jarvis;
  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const transcript = payload?.transcript?.trim() ?? "";
  const contextValue = payload?.contextValue ?? "";

  useAutoClearError(error, setError);

  const handleDismiss = useCallback(async (): Promise<void> => {
    try {
      await bridge.dismissOverlay();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to dismiss response overlay.",
      );
    }
  }, [bridge]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!payload) {
      return;
    }

    try {
      await bridge.copyOverlayContent(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy response.");
    }
  }, [bridge, payload]);

  useEffect(() => {
    const unsubscribe = bridge.onOverlayResponse((nextPayload: OverlayPayload) => {
      setPayload(nextPayload);
      setCopied(false);
      setError(null);
    });

    return () => unsubscribe();
  }, [bridge]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      handleDismiss().catch(() => undefined);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleDismiss]);

  return (
    <main className="app-shell app-shell-overlay">
      <section className="response-overlay">
        {(transcript.length > 0 || contextValue.length > 0) && (
          <div className="response-overlay-meta">
            {transcript.length > 0 && (
              <p className="response-overlay-transcript">
                <span className="response-overlay-label">Transcript</span>
                {transcript}
              </p>
            )}
            {contextValue.length > 0 && (
              <p className="response-overlay-context">
                <span className="response-overlay-label">Context</span>
                {contextValue}
              </p>
            )}
          </div>
        )}

        <div className="response-overlay-inner">
          {payload?.kind === "image" ? (
            <img
              src={payload.imageDataUrl}
              className="response-overlay-image"
              alt="Jarvis generated response"
            />
          ) : (
            <p className="response-overlay-text">{payload?.text ?? ""}</p>
          )}

          <button
            type="button"
            className="response-overlay-copy"
            onClick={() => {
              handleCopy().catch(() => undefined);
            }}
          >
            <Copy size={14} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <span className="response-overlay-hint">Press Esc to dismiss</span>
      </section>

      <div className={`error-toast error-toast-overlay ${error ? "visible" : ""}`}>
        {error}
      </div>
    </main>
  );
}

function PillWindow(): React.ReactElement {
  const bridge = window.jarvis;

  const [taskState, setTaskState] = useState<TaskState>("idle");
  const taskStateRef = useRef<TaskState>("idle");
  const recordingModeRef = useRef<RecordingMode>("auto");
  const [error, setError] = useState<string | null>(null);
  const [pillVisible, setPillVisible] = useState<boolean>(false);

  const {
    captureState,
    audioLevel,
    captureStateRef,
    startCapture,
    stopCapture,
    teardown,
  } = useAudioCapture(bridge);

  const displayState: DisplayState = error
    ? "error"
    : captureState !== "idle"
      ? captureState
      : taskState;

  const waveBars = useMemo((): Array<{ heightPx: number; opacity: number }> => {
    if (captureState !== "recording") {
      return Array.from({ length: WAVE_BAR_COUNT }, () => ({
        heightPx: WAVE_BAR_BASELINE_HEIGHT,
        opacity: 0.35,
      }));
    }

    const activityLevel = audioLevel > 0 ? Math.max(audioLevel, 0.08) : 0;

    return WAVE_BAR_PROFILE.map((profile) => {
      const weightedLevel = Math.min(1, activityLevel * profile);
      const heightPx =
        WAVE_BAR_BASELINE_HEIGHT +
        Math.round((WAVE_BAR_MAX_HEIGHT - WAVE_BAR_BASELINE_HEIGHT) * weightedLevel);
      const opacity = 0.42 + weightedLevel * 0.58;

      return { heightPx, opacity };
    });
  }, [audioLevel, captureState]);

  function setTaskStateNow(next: TaskState): void {
    taskStateRef.current = next;
    setTaskState(next);
  }

  const handleStartRecording = useCallback(
    async (mode: RecordingMode): Promise<void> => {
      recordingModeRef.current = mode;
      setError(null);
      setPillVisible(true);

      try {
        await startCapture();
      } catch (err) {
        recordingModeRef.current = "auto";
        setPillVisible(true);
        setError(
          err instanceof Error ? err.message : "Unable to start recording.",
        );
      }
    },
    [startCapture],
  );

  const handleStopRecording = useCallback(async (): Promise<void> => {
    const mode = recordingModeRef.current;
    recordingModeRef.current = "auto";

    try {
      const transcript = await stopCapture();
      if (!transcript) {
        setPillVisible(false);
        return;
      }

      setTaskStateNow("running_text");
      await bridge.runTextTask({
        instruction: transcript,
        mode,
      });
      setTaskStateNow("idle");
      setPillVisible(false);
    } catch (err) {
      setTaskStateNow("idle");
      setPillVisible(true);
      setError(err instanceof Error ? err.message : "Task failed.");
    }
  }, [bridge, stopCapture]);

  const handlePushToTalk = useCallback(
    async (mode: RecordingMode): Promise<void> => {
      if (captureStateRef.current === "recording") {
        await handleStopRecording();
        return;
      }

      if (
        captureStateRef.current === "idle" &&
        taskStateRef.current === "idle"
      ) {
        await handleStartRecording(mode);
      }
    },
    [captureStateRef, handleStartRecording, handleStopRecording],
  );

  useAutoClearError(error, setError);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timeout = window.setTimeout(() => setPillVisible(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!bridge) {
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

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
  }, [bridge, handlePushToTalk, teardown]);

  return (
    <main className="app-shell app-shell-pill">
      <div
        className={`pill-bar ${pillVisible ? "visible" : ""}`}
        data-state={displayState}
      >
        <div className="status-indicator">
          <StatusIcon state={displayState} />
        </div>

        <div className="pill-divider" />

        <div className="waveform-container">
          {waveBars.map((bar, index) => (
            <div
              key={index}
              className="wave-bar"
              style={{
                height: `${bar.heightPx}px`,
                opacity: bar.opacity,
              }}
            />
          ))}
        </div>

        <div className="pill-divider" />

        <div className="ai-indicator">
          <SparkleGroup />
        </div>
      </div>

      <div className={`error-toast error-toast-pill ${error ? "visible" : ""}`}>
        {error}
      </div>
    </main>
  );
}

function StatusIcon({ state }: { state: DisplayState }): React.ReactElement {
  if (state === "error") {
    return <XCircle size={20} className="status-icon" />;
  }

  if (state === "recording") {
    return <Circle size={20} className="status-icon" fill="currentColor" />;
  }

  return <Check size={20} className="status-icon" />;
}

function SparkleGroup(): React.ReactElement {
  return (
    <div className="sparkle-group">
      <Sparkles size={16} className="sparkle sparkle-main" />
      <Sparkles size={10} className="sparkle sparkle-small" />
    </div>
  );
}
