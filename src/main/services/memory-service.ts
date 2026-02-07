import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type {
  CreateMemoryRequest,
  MemoryEntry,
  MemoryKind,
  MemorySource,
  UpdateMemoryRequest,
} from "../types";

const ALLOWED_MEMORY_KINDS: ReadonlySet<MemoryKind> = new Set([
  "preference",
  "profile",
  "workflow",
  "project",
  "contact",
  "other",
]);

const ALLOWED_MEMORY_SOURCES: ReadonlySet<MemorySource> = new Set([
  "explicit_voice",
  "explicit_ui",
]);

interface MemoryStoreData {
  version: 1;
  memories: MemoryEntry[];
}

let cache: MemoryStoreData | null = null;

function getMemoryStorePath(): string {
  return join(app.getPath("userData"), "memory.json");
}

function ensureMemoryStoreDir(): void {
  const memoryStorePath = getMemoryStorePath();
  const memoryStoreDir = dirname(memoryStorePath);
  mkdirSync(memoryStoreDir, { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertMemoryKind(kind: string): asserts kind is MemoryKind {
  if (!ALLOWED_MEMORY_KINDS.has(kind as MemoryKind)) {
    throw new Error(`Invalid memory kind: ${kind}`);
  }
}

function assertMemorySource(source: string): asserts source is MemorySource {
  if (!ALLOWED_MEMORY_SOURCES.has(source as MemorySource)) {
    throw new Error(`Invalid memory source: ${source}`);
  }
}

function parseMemoryEntry(input: unknown): MemoryEntry {
  if (!isRecord(input)) {
    throw new Error("Invalid memory entry shape.");
  }

  const id = input.id;
  const content = input.content;
  const kind = input.kind;
  const source = input.source;
  const pinned = input.pinned;
  const createdAt = input.createdAt;
  const updatedAt = input.updatedAt;
  const lastUsedAt = input.lastUsedAt;

  if (
    typeof id !== "string" ||
    typeof content !== "string" ||
    typeof kind !== "string" ||
    typeof source !== "string" ||
    typeof pinned !== "boolean" ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string" ||
    (lastUsedAt !== null && typeof lastUsedAt !== "string")
  ) {
    throw new Error("Invalid memory entry fields.");
  }

  assertMemoryKind(kind);
  assertMemorySource(source);

  return {
    id,
    content,
    kind,
    source,
    pinned,
    createdAt,
    updatedAt,
    lastUsedAt,
  };
}

function parseMemoryStoreData(input: unknown): MemoryStoreData {
  if (!isRecord(input)) {
    throw new Error("Invalid memory store data.");
  }

  const version = input.version;
  const memories = input.memories;

  if (version !== 1 || !Array.isArray(memories)) {
    throw new Error("Unsupported memory store format.");
  }

  return {
    version: 1,
    memories: memories.map((memory) => parseMemoryEntry(memory)),
  };
}

function getInitialStore(): MemoryStoreData {
  return {
    version: 1,
    memories: [],
  };
}

function cloneStore(store: MemoryStoreData): MemoryStoreData {
  return {
    version: 1,
    memories: store.memories.map((memory) => ({ ...memory })),
  };
}

function ensureStoreLoaded(): MemoryStoreData {
  if (cache) {
    return cache;
  }

  ensureMemoryStoreDir();
  const memoryStorePath = getMemoryStorePath();
  if (!existsSync(memoryStorePath)) {
    cache = getInitialStore();
    persistStore(cache);
    return cache;
  }

  try {
    const raw = readFileSync(memoryStorePath, "utf8");
    const parsed = parseMemoryStoreData(JSON.parse(raw) as unknown);
    cache = parsed;
  } catch {
    const backupPath = `${memoryStorePath}.corrupt-${Date.now()}.bak`;
    try {
      copyFileSync(memoryStorePath, backupPath);
    } catch {
      // If backup fails, continue with empty store to recover startup.
    }
    cache = getInitialStore();
    persistStore(cache);
  }

  return cache;
}

function persistStore(store: MemoryStoreData): void {
  ensureMemoryStoreDir();
  const memoryStorePath = getMemoryStorePath();
  const tempPath = `${memoryStorePath}.tmp`;
  const serialized = JSON.stringify(store, null, 2);
  writeFileSync(tempPath, serialized, "utf8");
  renameSync(tempPath, memoryStorePath);
}

function commitStore(nextStore: MemoryStoreData): void {
  cache = nextStore;
  try {
    persistStore(nextStore);
  } catch (error) {
    cache = null;
    const memoryStorePath = getMemoryStorePath();
    const tempPath = `${memoryStorePath}.tmp`;
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }
}

function sanitizeMemoryContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("Memory content cannot be empty.");
  }
  return trimmed;
}

function findMemoryIndex(store: MemoryStoreData, id: string): number {
  return store.memories.findIndex((memory) => memory.id === id);
}

export function listMemories(): MemoryEntry[] {
  const store = ensureStoreLoaded();
  const sortedMemories = [...store.memories].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  return sortedMemories.map((memory) => ({ ...memory }));
}

export function createMemory(request: CreateMemoryRequest): MemoryEntry {
  const store = ensureStoreLoaded();
  const now = new Date().toISOString();
  const content = sanitizeMemoryContent(request.content);
  const kind = request.kind;
  const source = request.source ?? "explicit_ui";

  assertMemoryKind(kind);
  assertMemorySource(source);

  const created: MemoryEntry = {
    id: randomUUID(),
    content,
    kind,
    source,
    pinned: request.pinned === true,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  };

  const nextStore = cloneStore(store);
  nextStore.memories.push(created);
  commitStore(nextStore);
  return { ...created };
}

export function updateMemory(request: UpdateMemoryRequest): MemoryEntry {
  const store = ensureStoreLoaded();
  const kind = request.kind;
  assertMemoryKind(kind);

  const nextStore = cloneStore(store);
  const index = findMemoryIndex(nextStore, request.id);
  if (index === -1) {
    throw new Error("Memory entry not found.");
  }

  const current = nextStore.memories[index];
  const updated: MemoryEntry = {
    ...current,
    content: sanitizeMemoryContent(request.content),
    kind,
    pinned: request.pinned,
    updatedAt: new Date().toISOString(),
  };
  nextStore.memories[index] = updated;
  commitStore(nextStore);
  return { ...updated };
}

export function deleteMemory(id: string): void {
  const store = ensureStoreLoaded();
  const nextStore = cloneStore(store);
  const index = findMemoryIndex(nextStore, id);
  if (index === -1) {
    throw new Error("Memory entry not found.");
  }
  nextStore.memories.splice(index, 1);
  commitStore(nextStore);
}

export function getMemoryPromptContext(limit = 12): string[] {
  const memories = listMemories().slice(0, limit);
  return memories.map((memory) => {
    const pinMarker = memory.pinned ? "pinned" : "memory";
    return `[${pinMarker}/${memory.kind}] ${memory.content}`;
  });
}

function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(token: string): string {
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function buildSearchTokens(query: string): string[] {
  const stopWords: ReadonlySet<string> = new Set([
    "a",
    "an",
    "the",
    "is",
    "are",
    "to",
    "for",
    "of",
    "on",
    "in",
    "at",
    "and",
    "or",
    "but",
    "my",
    "me",
    "you",
    "your",
    "i",
    "what",
    "whats",
    "who",
    "when",
    "where",
    "why",
    "how",
    "tell",
    "about",
    "please",
    "can",
    "could",
    "would",
    "will",
    "do",
    "does",
    "did",
    "jarvis",
  ]);

  const normalizedQuery = normalizeForSearch(query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  const rawTokens = normalizedQuery
    .split(" ")
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 3 && !stopWords.has(token));

  return Array.from(new Set(rawTokens));
}

function scoreMemoryForTokens(memory: MemoryEntry, tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }

  const normalizedMemory = normalizeForSearch(memory.content);
  const tokenMatches = tokens.reduce((count, token) => {
    if (normalizedMemory.includes(token)) {
      return count + 1;
    }
    return count;
  }, 0);

  if (tokenMatches === 0) {
    return 0;
  }

  const pinBoost = memory.pinned ? 2 : 0;
  return tokenMatches * 4 + pinBoost;
}

export function getMemoryPromptContextForQuery(params: {
  query: string;
  limit?: number;
}): string[] {
  const limit = params.limit ?? 12;
  const tokens = buildSearchTokens(params.query);
  const memories = listMemories();

  const ranked = memories
    .map((memory) => ({
      memory,
      score: scoreMemoryForTokens(memory, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return right.memory.updatedAt.localeCompare(left.memory.updatedAt);
    })
    .slice(0, limit);

  if (ranked.length === 0) {
    return [];
  }

  return ranked.map(({ memory }) => {
    const pinMarker = memory.pinned ? "pinned" : "memory";
    return `[${pinMarker}/${memory.kind}] ${memory.content}`;
  });
}

export function touchMemory(id: string): void {
  const store = ensureStoreLoaded();
  const nextStore = cloneStore(store);
  const index = findMemoryIndex(nextStore, id);
  if (index === -1) {
    return;
  }
  const now = new Date().toISOString();
  const current = nextStore.memories[index];
  nextStore.memories[index] = {
    ...current,
    lastUsedAt: now,
    updatedAt: now,
  };
  commitStore(nextStore);
}
