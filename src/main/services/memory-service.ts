import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";

interface LegacyMemoryEntry {
  content?: string;
}

interface LegacyMemoryStore {
  memories?: LegacyMemoryEntry[];
}

const MEMORY_TEXT_FILE_NAME = "memory.txt";
const LEGACY_MEMORY_JSON_FILE_NAME = "memory.json";

function getMemoryTextPath(): string {
  return join(app.getPath("userData"), MEMORY_TEXT_FILE_NAME);
}

function getLegacyMemoryJsonPath(): string {
  return join(app.getPath("userData"), LEGACY_MEMORY_JSON_FILE_NAME);
}

function ensureMemoryStoreDir(): void {
  mkdirSync(dirname(getMemoryTextPath()), { recursive: true });
}

function parseMemoryLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function migrateLegacyMemoryJsonIfNeeded(): void {
  const memoryTextPath = getMemoryTextPath();
  if (existsSync(memoryTextPath)) {
    return;
  }

  const legacyPath = getLegacyMemoryJsonPath();
  if (!existsSync(legacyPath)) {
    return;
  }

  try {
    const rawLegacy = readFileSync(legacyPath, "utf8");
    const parsed = JSON.parse(rawLegacy) as LegacyMemoryStore;
    const memories = Array.isArray(parsed.memories) ? parsed.memories : [];
    const lines = memories
      .map((memory) => memory.content)
      .filter((content): content is string => typeof content === "string")
      .map((content) => content.trim())
      .filter((content) => content.length > 0);
    writeFileSync(memoryTextPath, lines.join("\n"), "utf8");
  } catch {
    writeFileSync(memoryTextPath, "", "utf8");
  }
}

function readMemoryText(): string {
  ensureMemoryStoreDir();
  migrateLegacyMemoryJsonIfNeeded();
  const memoryTextPath = getMemoryTextPath();
  if (!existsSync(memoryTextPath)) {
    writeFileSync(memoryTextPath, "", "utf8");
    return "";
  }
  return readFileSync(memoryTextPath, "utf8");
}

function writeMemoryText(text: string): void {
  ensureMemoryStoreDir();
  writeFileSync(getMemoryTextPath(), text.replace(/\r\n/g, "\n"), "utf8");
}

export function getMemoryText(): string {
  return readMemoryText();
}

export function setMemoryText(text: string): void {
  writeMemoryText(text);
}

export function getMemoryPromptContext(): string[] {
  const memoryText = readMemoryText();
  if (memoryText.trim().length === 0) {
    return [];
  }
  return [memoryText];
}
