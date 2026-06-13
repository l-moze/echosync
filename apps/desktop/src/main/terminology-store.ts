import fs from "node:fs/promises";
import path from "node:path";

import type {
  TerminologyEntry,
  TerminologyEntryType,
  TerminologyImportInput,
  TerminologyLibrary,
  TerminologyLibrarySummary,
  TerminologyLibraryUpdate
} from "../shared/terminology";

export type TerminologyStore = {
  delete: (id: string) => Promise<void>;
  importLibrary: (input: TerminologyImportInput) => Promise<TerminologyLibrary>;
  list: () => Promise<TerminologyLibrarySummary[]>;
  update: (id: string, patch: TerminologyLibraryUpdate) => Promise<TerminologyLibrary>;
};

type TerminologyStoreFile = {
  libraries: TerminologyLibrary[];
};

const TERMINOLOGY_TYPES = new Set<TerminologyEntryType>(["translation", "keep", "explain"]);

export function createTerminologyStore(rootDir: string): TerminologyStore {
  const terminologyDir = path.join(rootDir, "terminology");
  const storePath = path.join(terminologyDir, "libraries.json");

  async function ensureStoreDir() {
    await fs.mkdir(terminologyDir, { recursive: true });
  }

  async function readStore(): Promise<TerminologyStoreFile> {
    await ensureStoreDir();
    try {
      const parsed = JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<TerminologyStoreFile>;
      return {
        libraries: Array.isArray(parsed.libraries) ? parsed.libraries.map(normalizeLibrary) : []
      };
    } catch (error) {
      if (isNotFound(error)) {
        return { libraries: [] };
      }
      throw error;
    }
  }

  async function writeStore(store: TerminologyStoreFile) {
    await ensureStoreDir();
    await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  return {
    async delete(id) {
      const store = await readStore();
      const libraries = store.libraries.filter((library) => library.id !== id);
      if (libraries.length === store.libraries.length) {
        return;
      }
      await writeStore({ libraries });
    },

    async importLibrary(input) {
      const entries = parseTerminologyEntries(input);
      if (!entries.length) {
        throw new Error("术语文件没有可导入的有效条目。");
      }
      const now = new Date().toISOString();
      const library: TerminologyLibrary = {
        id: createTerminologyLibraryId(),
        name: normalizeTerminologyName(input.name),
        enabled: true,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        entryCount: entries.length,
        entries,
        createdAt: now,
        updatedAt: now
      };
      const store = await readStore();
      await writeStore({ libraries: [library, ...store.libraries] });
      return library;
    },

    async list() {
      const store = await readStore();
      return store.libraries
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map(toTerminologyLibrarySummary);
    },

    async update(id, patch) {
      const store = await readStore();
      const index = store.libraries.findIndex((library) => library.id === id);
      if (index === -1) {
        throw new Error(`未找到术语库：${id}`);
      }
      const current = store.libraries[index];
      if (!current) {
        throw new Error(`未找到术语库：${id}`);
      }
      const next: TerminologyLibrary = {
        ...current,
        enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
        name: patch.name ? normalizeTerminologyName(patch.name) : current.name,
        updatedAt: new Date().toISOString()
      };
      const libraries = store.libraries.slice();
      libraries[index] = next;
      await writeStore({ libraries });
      return next;
    }
  };
}

function parseTerminologyEntries(input: TerminologyImportInput): TerminologyEntry[] {
  const format = input.format ?? inferTerminologyFormat(input.name);
  const rawEntries = format === "json"
    ? parseJsonTerminologyEntries(input.content)
    : parseDelimitedTerminologyEntries(input.content);
  const seen = new Set<string>();
  const entries: TerminologyEntry[] = [];
  for (const entry of rawEntries) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.source.toLocaleLowerCase()}|${normalized.target.toLocaleLowerCase()}|${normalized.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(normalized);
  }
  return entries;
}

function parseJsonTerminologyEntries(content: string): Array<Partial<TerminologyEntry>> {
  const parsed = JSON.parse(content) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.entries)
      ? parsed.entries
      : [];
  return entries.map((item): Partial<TerminologyEntry> => {
    if (!isObject(item)) {
      return {};
    }
    return {
      note: readString(item.note),
      source: readString(item.source) ?? readString(item.term) ?? readString(item.from),
      target: readString(item.target) ?? readString(item.translation) ?? readString(item.to),
      type: normalizeEntryType(readString(item.type))
    };
  });
}

function parseDelimitedTerminologyEntries(content: string): Array<Partial<TerminologyEntry>> {
  return content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line): Partial<TerminologyEntry> => {
      const cells = splitTerminologyLine(line);
      return {
        source: cells[0],
        target: cells[1] ?? cells[0],
        type: normalizeEntryType(cells[2]),
        note: cells[3]
      };
    });
}

function splitTerminologyLine(line: string) {
  if (line.includes("\t")) {
    return line.split("\t").map((cell) => cell.trim());
  }
  for (const delimiter of ["=>", "->", "="]) {
    if (line.includes(delimiter)) {
      return line.split(delimiter).map((cell) => cell.trim());
    }
  }
  return splitCsvLine(line).map((cell) => cell.trim());
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

function normalizeEntry(entry: Partial<TerminologyEntry>): TerminologyEntry | null {
  const source = entry.source?.trim();
  if (!source) {
    return null;
  }
  const target = entry.target?.trim() || source;
  return {
    source,
    target,
    type: normalizeEntryType(entry.type),
    ...(entry.note?.trim() ? { note: entry.note.trim() } : {})
  };
}

function normalizeEntryType(value: string | undefined): TerminologyEntryType {
  if (value && TERMINOLOGY_TYPES.has(value as TerminologyEntryType)) {
    return value as TerminologyEntryType;
  }
  return "translation";
}

function inferTerminologyFormat(name: string) {
  const extension = path.extname(name).toLocaleLowerCase();
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".csv") {
    return "csv";
  }
  return "txt";
}

function normalizeLibrary(library: TerminologyLibrary): TerminologyLibrary {
  const entries = Array.isArray(library.entries)
    ? library.entries.map(normalizeEntry).filter((entry): entry is TerminologyEntry => Boolean(entry))
    : [];
  return {
    id: library.id || createTerminologyLibraryId(),
    name: normalizeTerminologyName(library.name),
    enabled: library.enabled !== false,
    sourceLang: library.sourceLang,
    targetLang: library.targetLang,
    entryCount: entries.length,
    entries,
    createdAt: library.createdAt || new Date().toISOString(),
    updatedAt: library.updatedAt || library.createdAt || new Date().toISOString()
  };
}

function normalizeTerminologyName(name: string | undefined) {
  const normalized = name?.replace(/\.[^.]+$/, "").trim();
  return normalized || "未命名术语库";
}

function toTerminologyLibrarySummary(library: TerminologyLibrary): TerminologyLibrarySummary {
  const { entries: _entries, ...summary } = library;
  return summary;
}

function createTerminologyLibraryId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `term_${Date.now().toString(36)}_${random}`;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
