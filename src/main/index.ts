import "dotenv/config";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  nativeImage,
  screen,
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import log from "electron-log/main.js";
import { registerIpcHandlers } from "./ipc";
import { IPC_CHANNELS } from "./ipc-channels";
import type { OverlayPayload } from "./types";
import { setResponseOverlayHandlers } from "./services/response-overlay-service";
import {
  initializeGradiumSttConnection,
  shutdownGradiumSttConnection,
} from "./services/gradium-stt-service";

type RendererHash = "#settings" | "#pill" | "#overlay";

log.initialize();

let settingsWindow: BrowserWindow | null = null;
let pillWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let cachedAppIcon: Electron.NativeImage | null = null;

function resolveAssetPath(fileName: string): string | null {
  const candidates = [
    join(process.cwd(), "public", fileName),
    join(app.getAppPath(), "public", fileName),
    join(__dirname, "../../public", fileName),
    join(__dirname, "../public", fileName),
  ];

  for (const candidatePath of candidates) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function loadImageAsset(
  fileName: string,
  size?: { width: number; height: number },
): Electron.NativeImage {
  const assetPath = resolveAssetPath(fileName);
  if (!assetPath) {
    return nativeImage.createEmpty();
  }

  const image = nativeImage.createFromPath(assetPath);
  if (image.isEmpty()) {
    return nativeImage.createEmpty();
  }

  if (!size) {
    return image;
  }

  return image.resize(size);
}

function getAppIconImage(): Electron.NativeImage {
  if (cachedAppIcon) {
    return cachedAppIcon;
  }

  cachedAppIcon = loadImageAsset("jarvis.png");
  return cachedAppIcon;
}

function getWindowIcon(): Electron.NativeImage | undefined {
  const image = getAppIconImage();
  return image.isEmpty() ? undefined : image;
}

function resolvePreloadPath(): string {
  const cjsPath = join(__dirname, "../preload/index.cjs");
  if (existsSync(cjsPath)) {
    return cjsPath;
  }
  return join(__dirname, "../preload/index.js");
}

function loadRendererRoute(
  targetWindow: BrowserWindow,
  hash: RendererHash,
): void {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    const url = new URL(rendererUrl);
    url.hash = hash;
    targetWindow.loadURL(url.toString());
    return;
  }

  targetWindow.loadFile(join(__dirname, "../renderer/index.html"), {
    hash: hash.slice(1),
  });
}

function positionPillWindow(): void {
  if (!pillWindow || pillWindow.isDestroyed()) {
    return;
  }

  const currentBounds = pillWindow.getBounds();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;

  const x = Math.round(area.x + (area.width - currentBounds.width) / 2);
  const y = Math.round(area.y + area.height - currentBounds.height - 50);

  pillWindow.setPosition(x, y, false);
}

function showPillWindow(): void {
  if (!pillWindow || pillWindow.isDestroyed()) {
    return;
  }

  positionPillWindow();

  if (pillWindow.isMinimized()) {
    pillWindow.restore();
  }

  if (!pillWindow.isVisible()) {
    if (process.platform === "darwin") {
      pillWindow.showInactive();
    } else {
      pillWindow.show();
    }
  }

  pillWindow.moveTop();
}

function positionOverlayWindow(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const currentBounds = overlayWindow.getBounds();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;

  const x = Math.round(area.x + (area.width - currentBounds.width) / 2);
  const y = Math.round(area.y + 24);

  overlayWindow.setPosition(x, y, false);
}

function showOverlayWindow(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  positionOverlayWindow();

  if (overlayWindow.isMinimized()) {
    overlayWindow.restore();
  }

  if (!overlayWindow.isVisible()) {
    overlayWindow.show();
  }

  overlayWindow.focus();
  overlayWindow.moveTop();
}

function hideOverlayWindow(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.hide();
}

function emitOverlayResponse(payload: OverlayPayload): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  if (overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.once("did-finish-load", () => {
      overlayWindow?.webContents.send(IPC_CHANNELS.overlayResponse, payload);
      showOverlayWindow();
    });
    return;
  }

  overlayWindow.webContents.send(IPC_CHANNELS.overlayResponse, payload);
  showOverlayWindow();
}

function createPillWindow(): void {
  if (pillWindow && !pillWindow.isDestroyed()) {
    return;
  }

  pillWindow = new BrowserWindow({
    show: false,
    width: 460,
    height: 118,
    icon: getWindowIcon(),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: false,
    focusable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  pillWindow.setAlwaysOnTop(true, "screen-saver");
  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRendererRoute(pillWindow, "#pill");

  pillWindow.on("ready-to-show", () => {
    positionPillWindow();
  });

  pillWindow.on("closed", () => {
    pillWindow = null;
  });
}

function createOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow = new BrowserWindow({
    show: false,
    width: 720,
    height: 220,
    icon: getWindowIcon(),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: false,
    focusable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRendererRoute(overlayWindow, "#overlay");

  overlayWindow.on("ready-to-show", () => {
    positionOverlayWindow();
  });

  overlayWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      hideOverlayWindow();
    }
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    return;
  }

  settingsWindow = new BrowserWindow({
    show: false,
    width: 560,
    height: 640,
    icon: getWindowIcon(),
    minWidth: 480,
    minHeight: 520,
    title: "Jarvis Settings",
    type: "normal",
    alwaysOnTop: false,
    resizable: true,
    movable: true,
    focusable: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#050505",
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  settingsWindow.removeMenu();
  loadRendererRoute(settingsWindow, "#settings");

  settingsWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      settingsWindow?.hide();
    }
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function showSettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettingsWindow();
  }

  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return;
  }

  if (settingsWindow.isMinimized()) {
    settingsWindow.restore();
  }

  settingsWindow.show();
  settingsWindow.focus();
}

function createTrayIcon(): Electron.NativeImage {
  const image = loadImageAsset("mic.png", { width: 18, height: 18 });
  if (!image.isEmpty()) {
    image.setTemplateImage(false);
    return image;
  }

  const fallbackSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#22c55e"/><text x="9" y="12" text-anchor="middle" font-size="9" font-family="sans-serif" fill="#ffffff">J</text></svg>';
  const fallbackImage = nativeImage
    .createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString("base64")}`,
    )
    .resize({ width: 18, height: 18 });
  fallbackImage.setTemplateImage(false);
  return fallbackImage;
}

function createStatusTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Jarvis");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { type: "separator" },
      {
        label: "Settings",
        click: () => showSettingsWindow(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]),
  );
}

function emitShortcutEvent(channel: string): void {
  if (!pillWindow || pillWindow.isDestroyed()) {
    createPillWindow();
  }

  if (!pillWindow || pillWindow.isDestroyed()) {
    return;
  }

  showPillWindow();

  if (pillWindow.webContents.isLoading()) {
    pillWindow.webContents.once("did-finish-load", () => {
      pillWindow?.webContents.send(channel);
    });
    return;
  }

  pillWindow.webContents.send(channel);
}

function registerPushToTalkShortcuts(): void {
  const registeredDefault = globalShortcut.register("Alt+Space", () => {
    emitShortcutEvent(IPC_CHANNELS.pushToTalkShortcut);
  });
  if (!registeredDefault) {
    log.warn("Failed to register global shortcut: Alt+Space");
  } else {
    log.info("Registered global shortcut: Alt+Space");
  }

  const registeredDictation = globalShortcut.register("Alt+Shift+Space", () => {
    emitShortcutEvent(IPC_CHANNELS.pushToTalkDictationShortcut);
  });
  if (!registeredDictation) {
    log.warn("Failed to register global shortcut: Alt+Shift+Space");
  } else {
    log.info("Registered global shortcut: Alt+Shift+Space");
  }
}

app.whenReady().then(() => {
  const appIcon = getAppIconImage();
  if (process.platform === "darwin" && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon);
  }

  registerIpcHandlers();
  initializeGradiumSttConnection().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to initialize Gradium STT connection.";
    log.warn("Gradium STT init failed:", message);
  });

  createPillWindow();
  createOverlayWindow();
  setResponseOverlayHandlers({
    onShow: (payload: OverlayPayload) => {
      emitOverlayResponse(payload);
    },
    onDismiss: () => {
      hideOverlayWindow();
    },
  });
  createStatusTray();
  registerPushToTalkShortcuts();

  screen.on("display-metrics-changed", () => positionPillWindow());
  screen.on("display-added", () => positionPillWindow());
  screen.on("display-removed", () => positionPillWindow());
  screen.on("display-metrics-changed", () => positionOverlayWindow());
  screen.on("display-added", () => positionOverlayWindow());
  screen.on("display-removed", () => positionOverlayWindow());

  if (process.platform === "darwin") {
    app.dock.hide();
  }

  app.on("activate", () => {
    showSettingsWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in the menu bar without visible windows.
});

app.on("before-quit", () => {
  isQuitting = true;
  shutdownGradiumSttConnection();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});
