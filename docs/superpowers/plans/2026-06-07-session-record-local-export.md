# Session Record Local Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real local file export for session records in DOCX, Markdown, TXT, SRT, JSON, and CSV.

**Architecture:** Shared code defines export formats, file extensions, labels, filenames, and text serializers. Electron main creates export payloads, shows the save dialog, and writes files. The renderer calls a new preload API and updates export status while keeping Markdown copy.

**Tech Stack:** Electron IPC, Node `fs/promises`, TypeScript, Vitest, `docx` npm package.

---

## File Structure

- Modify `apps/desktop/src/shared/session-records.ts` for export format types, metadata, JSON, and CSV serializers.
- Create `apps/desktop/src/main/session-record-exporter.ts` for export payload generation, safe filenames, DOCX generation, save-dialog options, and file writes.
- Modify `apps/desktop/src/main/session-record-store.ts` to expose full-record export text for new formats.
- Modify `apps/desktop/src/shared/desktop-api.ts` and `apps/desktop/src/preload/index.ts` to expose `sessionRecords.saveExport`.
- Modify `apps/desktop/src/main/main.ts` to register `session-records:save-export`.
- Modify `apps/desktop/src/renderer/main.tsx` to call `saveExport`, render all format actions, and keep Markdown copy.
- Modify `apps/desktop/tests/session-records.test.ts` for JSON/CSV serializer behavior.
- Add `apps/desktop/tests/session-record-exporter.test.ts` for main-process export payload and filename behavior.
- Modify `apps/desktop/tests/renderer-record-window-contract.test.ts` for renderer contract changes.
- Update `apps/desktop/package.json` and `apps/desktop/package-lock.json` with `docx`.

---

### Task 1: Shared Export Formats

**Files:**
- Modify: `apps/desktop/src/shared/session-records.ts`
- Test: `apps/desktop/tests/session-records.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```ts
expect(SESSION_RECORD_EXPORT_FORMATS.map((format) => format.id)).toEqual([
  "docx",
  "markdown",
  "txt",
  "srt",
  "json",
  "csv"
]);
expect(serializeSessionRecordJson(record)).toContain('"title": "网课复盘"');
expect(serializeSessionRecordCsv(record)).toContain("index,start_ms,end_ms,source_text,target_text,revision_state,patch_count");
```

- [ ] **Step 2: Run failing test**

Run: `npm --prefix apps/desktop test -- session-records.test.ts`

Expected: fail because `SESSION_RECORD_EXPORT_FORMATS`, `serializeSessionRecordJson`, and `serializeSessionRecordCsv` do not exist.

- [ ] **Step 3: Implement minimal shared code**

Extend `SessionRecordExportFormat` to:

```ts
export type SessionRecordExportFormat = "docx" | "markdown" | "srt" | "txt" | "json" | "csv";
```

Add `SESSION_RECORD_EXPORT_FORMATS`, `serializeSessionRecordJson`, and `serializeSessionRecordCsv`. JSON should be pretty-printed with two spaces. CSV should quote fields with commas, quotes, or line breaks.

- [ ] **Step 4: Verify green**

Run: `npm --prefix apps/desktop test -- session-records.test.ts`

Expected: pass.

---

### Task 2: Main Export Payloads And DOCX

**Files:**
- Create: `apps/desktop/src/main/session-record-exporter.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/package-lock.json`
- Test: `apps/desktop/tests/session-record-exporter.test.ts`

- [ ] **Step 1: Install DOCX dependency**

Run: `npm --prefix apps/desktop install docx`

Expected: `docx` appears in `apps/desktop/package.json` and lockfile.

- [ ] **Step 2: Write failing tests**

Add tests for:

```ts
expect(defaultExportFileName(record, "markdown")).toBe("网课复盘.md");
expect(defaultExportFileName({ ...record, title: "A/B:C*D?" }, "csv")).toBe("A_B_C_D_.csv");
const csv = await buildSessionRecordExportPayload(record, "csv");
expect(csv).toMatchObject({ extension: "csv", mimeType: "text/csv;charset=utf-8" });
const docx = await buildSessionRecordExportPayload(record, "docx");
expect(Buffer.isBuffer(docx.data)).toBe(true);
expect(docx.data.byteLength).toBeGreaterThan(100);
```

- [ ] **Step 3: Run failing test**

Run: `npm --prefix apps/desktop test -- session-record-exporter.test.ts`

Expected: fail because module does not exist.

- [ ] **Step 4: Implement exporter module**

Create functions:

```ts
export async function buildSessionRecordExportPayload(record: SessionRecord, format: SessionRecordExportFormat): Promise<SessionRecordExportPayload>
export function defaultExportFileName(record: Pick<SessionRecord, "title">, format: SessionRecordExportFormat): string
export function exportDialogFilters(format: SessionRecordExportFormat): Electron.FileFilter[]
```

Text formats return `Buffer.from(text, "utf8")`. DOCX uses `Document`, `Packer`, `Paragraph`, and `TextRun` from `docx`.

- [ ] **Step 5: Verify green**

Run: `npm --prefix apps/desktop test -- session-record-exporter.test.ts`

Expected: pass.

---

### Task 3: IPC Save Export

**Files:**
- Modify: `apps/desktop/src/shared/desktop-api.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Test: `apps/desktop/tests/renderer-record-window-contract.test.ts`

- [ ] **Step 1: Write failing contract test**

Update the renderer/preload contract test to expect:

```ts
expect(rendererSource).toContain("window.echosyncDesktop?.sessionRecords.saveExport(selectedRecord.id, format)");
expect(rendererSource).toContain("Markdown 复制");
expect(actionsSource).toContain("DOCX");
expect(actionsSource).toContain("JSON");
expect(actionsSource).toContain("CSV");
```

- [ ] **Step 2: Run failing test**

Run: `npm --prefix apps/desktop test -- renderer-record-window-contract.test.ts`

Expected: fail because `saveExport` is not wired or rendered.

- [ ] **Step 3: Implement IPC bridge**

Add:

```ts
saveExport: (id: string, format: SessionRecordExportFormat) => Promise<SessionRecordSaveExportResult>;
```

Expose preload invoke:

```ts
saveExport: (id, format) => ipcRenderer.invoke("session-records:save-export", id, format)
```

Register main IPC that loads record, builds payload, opens save dialog, writes file, and returns `{ canceled, path }`.

- [ ] **Step 4: Verify contract still fails for renderer UI only**

Run: `npm --prefix apps/desktop test -- renderer-record-window-contract.test.ts`

Expected: failure should only mention missing renderer strings if UI is not yet changed.

---

### Task 4: Renderer Export UI

**Files:**
- Modify: `apps/desktop/src/renderer/main.tsx`
- Test: `apps/desktop/tests/renderer-record-window-contract.test.ts`

- [ ] **Step 1: Implement renderer behavior**

Replace copy-only export with:

```ts
async function exportSelectedRecord(format: SessionRecordExportFormat = "docx") {
  if (!selectedRecord) return;
  try {
    const result = await window.echosyncDesktop?.sessionRecords.saveExport(selectedRecord.id, format);
    if (result?.canceled) {
      setExportStatus("已取消导出");
      return;
    }
    setExportStatus(`${sessionRecordExportFormatLabel(format)} 已导出到本地`);
  } catch (error) {
    log.warn("[session-records] 导出会议记录失败:", error);
    setExportStatus("导出失败");
  }
}
```

Keep Markdown copy in a separate action that calls `sessionRecords.export(..., "markdown")` and `copyText`.

- [ ] **Step 2: Verify contract green**

Run: `npm --prefix apps/desktop test -- renderer-record-window-contract.test.ts`

Expected: pass.

---

### Task 5: Full Verification

**Files:**
- All changed files

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm --prefix apps/desktop test -- session-records.test.ts session-record-exporter.test.ts renderer-record-window-contract.test.ts session-record-store.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:desktop`

Expected: pass.

- [ ] **Step 3: Run desktop test suite**

Run: `npm run test:desktop`

Expected: pass.
