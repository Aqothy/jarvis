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
import {
  initializeGradiumSttConnection,
  shutdownGradiumSttConnection,
} from "./services/gradium-stt-service";

type RendererHash = "#settings" | "#pill";

log.initialize();

let settingsWindow: BrowserWindow | null = null;
let pillWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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

function createPillWindow(): void {
  if (pillWindow && !pillWindow.isDestroyed()) {
    return;
  }

  pillWindow = new BrowserWindow({
    show: false,
    width: 460,
    height: 118,
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

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    return;
  }

  settingsWindow = new BrowserWindow({
    show: false,
    width: 560,
    height: 640,
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
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#22c55e"/><text x="9" y="12" text-anchor="middle" font-size="9" font-family="sans-serif" fill="#ffffff">J</text></svg>';
  const image = nativeImage
    .createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    )
    .resize({ width: 18, height: 18 });
  image.setTemplateImage(false);
  return image;
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
  registerIpcHandlers();
  initializeGradiumSttConnection().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to initialize Gradium STT connection.";
    log.warn("Gradium STT init failed:", message);
  });

  createPillWindow();
  createStatusTray();
  registerPushToTalkShortcuts();

  screen.on("display-metrics-changed", () => positionPillWindow());
  screen.on("display-added", () => positionPillWindow());
  screen.on("display-removed", () => positionPillWindow());

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
