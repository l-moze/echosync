export type TerminologyEntryType = "translation" | "keep" | "explain";

export type TerminologyEntry = {
  source: string;
  target: string;
  type: TerminologyEntryType;
  note?: string;
};

export type TerminologyLibrary = {
  id: string;
  name: string;
  enabled: boolean;
  sourceLang?: string;
  targetLang?: string;
  entryCount: number;
  entries: TerminologyEntry[];
  createdAt: string;
  updatedAt: string;
};

export type TerminologyLibrarySummary = Omit<TerminologyLibrary, "entries">;

export type TerminologyImportFormat = "csv" | "txt" | "json";

export type TerminologyImportInput = {
  content: string;
  format?: TerminologyImportFormat;
  name: string;
  sourceLang?: string;
  targetLang?: string;
};

export type TerminologyLibraryUpdate = {
  enabled?: boolean;
  name?: string;
};
