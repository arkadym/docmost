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

## Feature 2 — Overwrite Existing Pages on Import

Add an **"Overwrite existing pages"** option to the import flow (single-file and ZIP). When enabled, if an imported page title matches an existing page in the same space (and same parent for ZIP imports), the existing page content is updated instead of creating a duplicate.

The option is **opt-in** (checkbox, off by default).

### Matching Strategy

| Import type | Match key |
|-------------|-----------|
| Single file | `title` + `spaceId` + `parentPageId` (root if none) |
| ZIP / bulk  | `title` + `spaceId` + `parentPageId` (resolved during tree traversal) |

Title matching is case-insensitive, whitespace-trimmed.

### Files to Change (Feature 2)

| File | What changes |
|------|-------------|
| `apps/client/src/features/page/components/page-import-modal.tsx` | Add "Overwrite existing pages" `Checkbox` state; pass `overwrite` flag to `importPage()` / `importZip()` calls |
| `apps/client/src/features/page/services/page-service.ts` | Add `overwrite?: boolean` param to `importPage()` and `importZip()`; append `"overwrite"` field to `FormData` |
| `apps/server/src/integrations/import/import.controller.ts` | Bump `fields` limits by 1 on both endpoints; read `overwrite` string field, coerce to boolean, pass to service methods |
| `apps/server/src/integrations/import/services/import.service.ts` | In `importPage()`: when `overwrite=true` call `pageRepo.findByTitleInSpace()`, if found call `updatePage()` instead of `insertPage()` |
| `apps/server/src/integrations/import/services/file-import-task.service.ts` | In `processGenericImport()`: when `overwrite=true`, before inserting each page call `findByTitleInSpace(title, spaceId, parentPageId)`, if found do `UPDATE` instead of `INSERT` |
| `apps/server/src/database/repos/page/page.repo.ts` | Add `findByTitleInSpace(title: string, spaceId: string, parentPageId: string \| null)` — case-insensitive title lookup |

### Data Flow

```
User checks "Overwrite" → FormData.overwrite = "true"
  ↓
Controller reads field → passes overwrite=true to service
  ↓
Service: findByTitleInSpace(title, spaceId, parentPageId)
  → found  → updatePage(id, { content, ydoc, textContent, updatedAt })
  → not found → insertPage(...)  (normal path, creates new page)
```

## Notes

- Page history entries are created automatically by Hocuspocus whenever a document is opened after ydoc binary changes — no manual snapshot call needed.
- No schema/migration changes required for either feature.
- `overwrite` does not need to be persisted on `fileTask` for v1.
