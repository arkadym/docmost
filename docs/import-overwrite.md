# Import Overwrite Feature

## Motivation / Migration Workflow

The primary use-case driving this feature is a two-stage note migration:

1. **OneNote → Docmost via Joplin**
   - Import `.onepkg` archive(s) into Joplin (Joplin natively supports OneNote packages)
   - Export from Joplin as a **Joplin zip** (HTML or markdown format)
   - Import into Docmost using **Joplin** as the source — this preserves creation dates, note hierarchy, and attachments

2. **Obsidian vault → Docmost (overwrite pass)**
   - The same notebooks were later maintained as an Obsidian vault (plain markdown)
   - Import the Obsidian vault as a **generic zip** with **Overwrite = on**
   - Notes whose title matches an already-imported OneNote note get their content replaced with the newer Obsidian version
   - The original OneNote content is preserved in **page history** (Hocuspocus snapshots)
   - Notes that exist only in one source are unaffected

**Benefits:**
- No manual diffing between OneNote and Obsidian versions
- Full history of changes visible in Docmost page history
- Attachments/images from the OneNote pass are retained on the page record even after content overwrite

---

## Feature 1 — Joplin Markdown Header Processing

Joplin exports markdown notes with a structured header. Real-world example:

```
# SpecificationBinaryMapFile - mapsforge - ...

Created: 2014-09-05 14:50:04 +0800

Modified: 2021-11-27 23:19:13 +0700

---

(actual note content)
```

Key observations from the real format:
- **Empty lines** can appear between any of the header elements (title, `Created:`, `Modified:`, `---`)
- Date format is `YYYY-MM-DD HH:MM:SS +HHMM` — space instead of `T`, timezone without colon — not standard ISO 8601; needs normalizing to `YYYY-MM-DDTHH:MM:SS+HH:MM` before `new Date()` will parse it reliably

Currently the server only handles this header for **Joplin HTML** exports (via `processJoplinHtml`). The markdown path ignores it, so Joplin `.md` notes get a wrong title (filename) and no dates.

### What needs to happen

- Scan lines from the top, **skipping blank lines**, until either a non-header line is encountered or `---` is found
- Extract `# Title` → use as `bodyTitle` (same `selectLongerTitle` logic as HTML)
- Parse `Created:` → `createdAt`; normalize date string to ISO before parsing
- Parse `Modified:` → `updatedAt`; same normalization
- Remove all matched header lines (including intervening blank lines up to and including `---`) from the markdown before converting to HTML → ProseMirror

### Files to Change (Feature 1)

| File | What changes |
|------|-------------|
| `apps/server/src/integrations/import/services/import.service.ts` | Add `processJoplinMarkdown(markdown)` method — strips header, returns `{ cleanMarkdown, bodyTitle, bodyDate, modifiedDate }` |
| `apps/server/src/integrations/import/services/file-import-task.service.ts` | In the `.md` branch of `processGenericImport()`: when `isJoplin`, call `processJoplinMarkdown()` instead of plain `markdownToHtml()`; store `_joplinBodyTitle`, `_bodyDate`, `_bodyModifiedDate` on the page object |
| `apps/server/src/integrations/import/services/file-import-task.service.ts` | When building `pageDates`: if `bodyModifiedDate` is present, use it as `updatedAt` |

---

## Feature 2 — Import Options UI

Two options are exposed in the import modal. They live **above** the import buttons, separated from them by a horizontal divider line (matching the Export page modal design — Mantine `Switch` / toggle style, not checkboxes).

```
┌─────────────────────────────────────────┐
│  Skip root folder             [●──]  ON │
│  Overwrite existing pages    [──●]  OFF │
├─────────────────────────────────────────┤
│  [Markdown] [HTML] [DOCX] …             │
│                                         │
│  Import zip file  [Upload file]         │
└─────────────────────────────────────────┘
```

### Skip Root Folder (on by default)

When a zip contains all content under a single top-level directory (e.g. `Actonica LLC/`), this option controls whether that folder itself becomes a page:

- **ON** — root folder is skipped; its children are imported at space root (previous implicit behaviour)
- **OFF** — root folder is created as a page and children are nested under it

The server-side `skipRootFolder` detection already exists in `processGenericImport()`. It needs to be wired to a flag that travels the same path as `overwrite` (FormData → controller → service → queue job → processor → `processGenericImport(opts)`).

### Overwrite Existing Pages (off by default)

When enabled, a page whose title matches an existing page in the same space and same parent is **updated** instead of creating a duplicate. See matching strategy and data flow below.

### UI Design Rules

- Use Mantine `Switch` component (not `Checkbox`) — matches the export modal style
- Both switches sit in a `Stack` at the **top** of the modal content, before the `SimpleGrid` of buttons
- A Mantine `Divider` separates the switches from the buttons
- Labels: `"Skip root folder"` / `"Overwrite existing pages"`

### Files to Change (Feature 2)

| File | What changes |
|------|-------------|
| `apps/client/src/features/page/components/page-import-modal.tsx` | Replace `Checkbox` with two `Switch` controls for `skipRoot` (default `true`) and `overwrite` (default `false`); add `Divider`; move both above the buttons grid |
| `apps/client/src/features/page/services/page-service.ts` | Add `overwrite?: boolean` and `skipRoot?: boolean` params; append both to `FormData` |
| `apps/server/src/integrations/import/import.controller.ts` | Bump `fields` limit; read `overwrite` and `skipRoot` fields; pass both to service |
| `apps/server/src/integrations/import/services/import.service.ts` | `importZip()`: accept + pass `skipRoot` through queue job payload alongside `overwrite` |
| `apps/server/src/integrations/import/services/file-import-task.service.ts` | `processZIpImport()`: accept `skipRoot`; pass to `processGenericImport()`; inside: use `skipRoot` to conditionally apply the existing single-root-folder skipping logic instead of always skipping |
| `apps/server/src/integrations/import/processors/file-task.processor.ts` | Pass `job.data.skipRoot` to `processZIpImport()` |

### Matching Strategy (Overwrite)

| Import type | Match key |
|-------------|-----------|
| Single file | `title` + `spaceId` + `parentPageId` (root if none) |
| ZIP / bulk  | `title` + `spaceId` + `parentPageId` (resolved during tree traversal) |

Title matching is case-insensitive, whitespace-trimmed.

### Data Flow

```
FormData: overwrite="false", skipRoot="true"
  ↓
Controller → importZip(... overwrite, skipRoot)
  ↓
Queue job payload: { fileTaskId, overwrite, skipRoot }
  ↓
Processor → processZIpImport(fileTaskId, overwrite, skipRoot)
  ↓
processGenericImport({ extractDir, fileTask, overwrite, skipRoot })
  → skipRoot=true  → skip single root folder (existing logic)
  → skipRoot=false → create root folder as a page too
  → overwrite=true → findByTitleInSpace() before insert
```

---

## Feature 3 — Skip Unchanged Pages on Overwrite

### Motivation

When re-importing a vault on top of existing notes, the majority of pages have not changed — they differ from the DB copy only in trailing newlines or extra blank lines. Writing identical content to the DB wastes I/O, creates useless history entries, and resets `updatedAt` on untouched pages.

### Behaviour

When `overwrite=true` and a title match is found, **before** writing anything, compare the incoming text content against the stored `textContent`:

1. Normalize both sides: collapse all whitespace characters (`\s+` → `''`)
2. If equal → skip the update entirely; just remap `pageIdRemap` and `validPageIds` so child pages still resolve their `parentPageId` correctly
3. If different → proceed with the existing history-save + ydoc-replace + `updateTable` write

This comparison is free — `incoming textContent = jsonToText(prosemirrorJson)` is already computed; `existing.textContent` is already fetched by `findByTitleInSpace`.

### Status column in summary

The skip-unchanged logic feeds directly into Feature 4: a skipped page gets status `unchanged`.

### Files to Change (Feature 3)

| File | What changes |
|------|-------------|
| `apps/server/src/integrations/import/services/file-import-task.service.ts` | Inside the `if (existing)` overwrite block: normalize + compare text; on match set status `unchanged` and `continue`; on mismatch proceed as before |

---

## Feature 4 — Import Summary Report

### Motivation

After a large import (hundreds of notes) users need an audit trail: what was created, what was updated, what was already up to date. A Docmost page in the space is more convenient than a log file.

### Behaviour

- **Toggle**: `Create summary` — on the import modal, off by default; ZIP imports only (Markdown zip, HTML zip, Joplin zip, OneNote-via-Joplin)
- **Every run creates a fresh page** — no overwrite of previous summaries
- **Page location**: space root (no parent)
- **Page title**: `<zip-filename-without-ext> import summary`

### Summary Page Structure

Status uses emoji dots (standard markdown has no color support; emoji renders universally):
- 🟢 created
- 🟡 updated
- ⚪ unchanged

```markdown
# <zip filename without extension> import summary

Imported: 2026-04-02 14:35:22

Total processed: 142 | Created: 38 | Updated: 12 | Unchanged: 92

| File | Status |
|------|--------|
| Actonica LLC/HR/Вакансия.md | 🟢 created |
| Actonica LLC/Projects/Alpha.md | 🟡 updated |
| Actonica LLC/Projects/Beta.md | ⚪ unchanged |
| … | … |
```

The heading is an H1 so the import pipeline extracts it as the page title.

### Data Collection

A `SummaryEntry` is accumulated during the existing per-page loop — no extra DB queries:

```typescript
type ImportStatus = 'created' | 'updated' | 'unchanged';
interface SummaryEntry { filePath: string; status: ImportStatus; }
const summaryEntries: SummaryEntry[] = [];
```

| Event | Status recorded |
|-------|----------------|
| `overwrite=true`, title match, content identical | `unchanged` |
| `overwrite=true`, title match, content different | `updated` |
| No match (new insert) | `created` |
| Always (even when `overwrite=false`) | `created` |

### Summary Page Insert

After the main transaction commits successfully, if `createSummary=true`:

1. Build the markdown string (heading + totals paragraph + pipe table)
2. `markdownToHtml()` → `processHTML()` → `getProsemirrorContent()` → `createYdoc()`
3. Insert a new page via `trx.insertInto('pages')` at space root with a fresh UUID/slugId; use the import run timestamp as `createdAt`/`updatedAt`; `parentPageId = null`

The summary insert runs in its own small transaction **outside** the main import transaction — failure to create the summary does not roll back the imported pages.

### Data Flow

```
FormData: createSummary="true"
  ↓
Controller → importZip(... createSummary)
  ↓
Queue job payload: { fileTaskId, overwrite, skipRoot, createSummary }
  ↓
Processor → processZIpImport(fileTaskId, overwrite, skipRoot, createSummary)
  ↓
processGenericImport({ ..., createSummary })
  → accumulates summaryEntries[] during main loop
  → after main tx: inserts summary page if createSummary=true
```

### UI

Same Switch style as `overwrite` / `skipRoot`. Label: `"Create import summary"`. Position: third switch in the stack, below `Overwrite existing pages`.

### Files to Change (Feature 4)

| File | What changes |
|------|-------------|
| `apps/client/src/features/page/components/page-import-modal.tsx` | Add third `Switch` for `createSummary` (default `false`) |
| `apps/client/src/features/page/services/page-service.ts` | Add `createSummary?: boolean` param; append to `FormData` |
| `apps/server/src/integrations/import/import.controller.ts` | Read `createSummary` field; pass to service |
| `apps/server/src/integrations/import/services/import.service.ts` | `importZip()`: accept + pass `createSummary` via queue job payload |
| `apps/server/src/integrations/import/processors/file-task.processor.ts` | Pass `job.data.createSummary` to `processZIpImport()` |
| `apps/server/src/integrations/import/services/file-import-task.service.ts` | `processZIpImport()`: accept `createSummary`; pass to `processGenericImport()`; accumulate `summaryEntries[]`; build + insert summary page after main tx |

---

## Notes

- No schema/migration changes required for any feature.
- `overwrite`, `skipRoot`, and `createSummary` do not need to be persisted on `fileTask`.
- `skipRoot` and `createSummary` only affect ZIP imports; single-file import ignores both.
- The content-comparison normalization (`\s+` → `''`) intentionally ignores all whitespace differences, including punctuation-adjacent spaces. This is intentional — the goal is to detect truly new content, not minor formatting tweaks.

