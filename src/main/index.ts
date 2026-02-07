import "dotenv/config";
import { app, BrowserWindow, globalShortcut } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import log from "electron-log/main.js";
import { registerIpcHandlers } from "./ipc";

log.initialize();

let mainWindow: BrowserWindow | null = null;

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
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: "Jarvis MVP",
    backgroundColor: "#0f1216",
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
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

function registerPushToTalkShortcut(): void {
  const accelerators = ["Alt+Space"];

  for (const accelerator of accelerators) {
    const registered = globalShortcut.register(accelerator, () => {
      mainWindow?.webContents.send("assistant:push-to-talk-shortcut");
    });

    if (!registered) {
      log.warn(`Failed to register shortcut: ${accelerator}`);
    }
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  registerPushToTalkShortcut();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
