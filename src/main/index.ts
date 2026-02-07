import "dotenv/config";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  nativeImage,
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

log.initialize();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function resolvePreloadPath(): string {
  // Sandboxed preload scripts must be CJS. With "type": "module" in package.json,
  // electron-vite outputs CJS as .cjs. We check .cjs first, then fall back to .js.
  const cjsPath = join(__dirname, "../preload/index.cjs");
  if (existsSync(cjsPath)) {
    return cjsPath;
  }
  return join(__dirname, "../preload/index.js");
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 860,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    title: "Jarvis Settings",
    backgroundColor: "#0f1216",
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.removeMenu();

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function showSettingsWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
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
  if (!mainWindow) {
    createWindow();
  }
  if (!mainWindow) {
    return;
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send(channel);
    });
    return;
  }

  mainWindow.webContents.send(channel);
}

function registerPushToTalkShortcuts(): void {
  const registeredDefault = globalShortcut.register("Alt+Space", () => {
    emitShortcutEvent(IPC_CHANNELS.pushToTalkShortcut);
  });
  if (!registeredDefault) {
    log.warn("Failed to register global shortcut: Alt+Space");
  }

  const registeredDictation = globalShortcut.register("Alt+Shift+Space", () => {
    emitShortcutEvent(IPC_CHANNELS.pushToTalkDictationShortcut);
  });
  if (!registeredDictation) {
    log.warn("Failed to register global shortcut: Alt+Shift+Space");
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
  createWindow();
  createStatusTray();
  registerPushToTalkShortcuts();

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
