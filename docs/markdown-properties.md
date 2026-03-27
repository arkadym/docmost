# Markdown Properties (YAML Frontmatter) Support

Adds support for YAML frontmatter property blocks — compatible with the Obsidian / standard Markdown format:

```yaml
---
created: 2023-09-07T22:51:46 (UTC +07:00)
tags:
  - dex
  - exchange
  - DeFi
source: https://profinvestment.com/decentralized-exchanges-dex/
author: Редакция Profinvestment
---
```

---

## New files

### `packages/editor-ext/src/lib/page-properties/`

| File | Purpose |
|------|---------|
| `yaml-utils.ts` | Lightweight YAML frontmatter parser/serialiser (no external dependency). Handles strings, quoted strings, block arrays (`- item`), inline arrays (`[a, b]`). Also handles Obsidian's non-standard date format `2023-09-07T22:51:46 (UTC +07:00)`. |
| `page-properties.ts` | TipTap `Node` extension. Stores properties as a JSON attribute on a block-level atom node. Adds three editor commands: `insertPageProperties`, `updatePageProperties`, `deletePageProperties`. |
| `index.ts` | Exports for the above. |

### `apps/client/src/features/editor/components/page-properties/`

| File | Purpose |
|------|---------|
| `page-properties-view.tsx` | React `NodeView` component. Collapsible properties panel with smart per-field rendering (see below), inline editing, keyboard navigation, add/delete rows. |
| `page-properties.module.css` | Light/dark-mode scoped styles for the panel. |

---

## Modified files

### `packages/editor-ext/src/index.ts`
Exports the new `page-properties` package.

### `apps/client/src/features/editor/extensions/extensions.ts`
Imports and registers `PageProperties.configure({ view: PagePropertiesView })` in `mainExtensions`.

### `apps/client/src/features/editor/extensions/markdown-clipboard.ts`
Detects YAML frontmatter **before** the VS Code language check, so pasting from any source (Obsidian, plain text editor, VS Code) works:
- Parses frontmatter → calls `insertPageProperties`
- Pastes the stripped body as normal markdown

### `apps/client/src/features/editor/full-editor.tsx`
Adds a quiet **"Add properties"** ghost-button between the title and the editor body. It is:
- Aligned to match `.ProseMirror` padding (`3rem` desktop / `1rem` mobile)
- Hidden once a `pageProperties` node exists in the document

### `apps/server/src/collaboration/collaboration.util.ts`
Adds `PageProperties` to `tiptapExtensions` so the server-side Prosemirror/Yjs engine can serialise the node type (required for Ydoc generation on import).

### `apps/server/src/integrations/import/services/import.service.ts`
`processMarkdown()` now:
1. Checks for YAML frontmatter with `extractFrontmatter()`
2. If found, converts only the body to HTML, parses the properties, prepends a `pageProperties` node to the Prosemirror doc
3. Falls through to the original path if no frontmatter is present

Covers single-file `.md` import via **File → Import page**.

### `apps/server/src/integrations/import/services/file-import-task.service.ts`
The bulk ZIP import loop (used for Obsidian vault exports) does the same per `.md` file:
- Extracts frontmatter, stores raw YAML on the page node temporarily
- After HTML→Prosemirror conversion, prepends the `pageProperties` block

Covers **File → Import ZIP** (Obsidian vault export).

### `apps/client/src/features/editor/styles/core.css`
No changes (unchanged from upstream).

---

## Smart value rendering (read mode)

The view component automatically infers a display style from the property key name:

| Key pattern | Rendered as |
|-------------|-------------|
| `created`, `date`, `updated`, `modified` | Localised date+time (`Intl.DateTimeFormat(navigator.language)`) |
| `source`, `url`, `link`, `href` — or any value starting with `https?://` | `IconExternalLink` + clickable link (no underline; `border-bottom: none !important` overrides the global `.ProseMirror a` border) |
| `author`, `authors`, `creator`, `by` | `IconUser` + plain text chip |
| Array values (any key) | Mantine `Badge` pills, lowercase (`tt="none"`) |
| Everything else | Plain text |

In **edit mode** all values become plain text inputs; arrays are edited as comma-separated strings and re-split on save.

---

## Collaboration

The `pageProperties` node lives inside the Yjs document just like any other block, so all edits are synced across collaborators in real time.
