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

## Notes

- Page history entries are created automatically by Hocuspocus whenever a document is opened after ydoc binary changes — no manual snapshot call needed.
- No schema/migration changes required for either feature.
- Neither `overwrite` nor `skipRoot` need to be persisted on `fileTask` for v1.
- `skipRoot` only affects ZIP imports; single-file import ignores it.

