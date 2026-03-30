# FRD: XMind Import

## Overview

Allow users to drag-and-drop an `.xmind` file into the editor. The file is
converted server-side to PlantUML mindmap syntax and inserted as a regular
`plantuml` block. The original `.xmind` is stored as an attachment and linked
via a node attribute so the block can be re-imported later.

## User Flow

1. User drags an `.xmind` file onto the editor canvas.
2. The existing drop handler detects the `.xmind` MIME type / extension.
3. A slim modal appears:
   - File name + size
   - Single "Import as mind map" button (no format choice — always PlantUML)
4. On confirm:
   - `.xmind` uploaded as attachment (reusing existing attachment API).
   - Server extracts the embedded `content.json` from the ZIP archive.
   - Converts the topic tree → `@startmindmap` / `@endmindmap` PlantUML syntax.
   - Returns `{ plantumlCode, attachmentId }`.
5. A `plantuml` node is inserted with:
   - `attrs.src` — rendered diagram URL (same as normal plantuml flow)
   - `attrs.xmindAttachmentId` — id of the stored `.xmind` file
6. The block renders identically to any other PlantUML diagram.

## Toolbar (bubble menu on plantuml node)

Existing plantuml toolbar gains extra buttons when `xmindAttachmentId` is set:

| Button | Action |
|---|---|
| Edit | open split-view PlantUML editor (existing) |
| View | open lightbox (existing) |
| Align left / center / right | change diagram alignment (existing) |
| Download SVG | download the rendered SVG (existing) |
| **Download XMind** *(xmind only)* | download the original `.xmind` attachment |
| **Re-import** *(xmind only)* | open file picker, upload new `.xmind`, re-run conversion, update node attrs |
| Delete | remove node (existing) |

Re-import replaces `attrs.src` and `attrs.xmindAttachmentId` in-place, and clears `attrs.xmindModified`.

### Download XMind

When `xmindAttachmentId` is set, a "Download XMind" button appears in the toolbar.
Clicking it constructs the attachment file URL (`/api/files/{xmindAttachmentId}/{fileName}`)
and triggers a browser download. The file name is resolved by fetching attachment info
from the existing `GET /attachments/{id}` endpoint (or derived from the stored attachment
metadata). No new server endpoint needed.
No separate version history — document history already covers it.

### Manual edit warning

When the user saves changes in the PlantUML split-view editor on a block that has
`xmindAttachmentId` set, the attribute `xmindModified: true` is written to the node.

When **Re-import** is clicked and `xmindModified === true`, show a confirmation:

> **You have manually edited this diagram.**
> Re-importing will overwrite your changes with the content from the new XMind file.
> The previous version is saved in document history and can be restored.
>
> [Cancel] [Re-import anyway]

If the user confirms — proceed normally and clear `xmindModified`.
If `xmindModified` is false or absent — skip the prompt.

## Conversion Rules (XMind → PlantUML mindmap)

- Root topic → `* Root`
- Each child level → additional `*` prefix (`**`, `***`, …)
- Floating topics → appended as separate root-level items after the main tree
- Topic notes / labels → ignored (out of scope)

### Color mapping

PlantUML mindmap supports per-node background color via `[#RRGGBB]` syntax:
```
** [#1F2766] Main topic
*** [#EEEBEE] Sub topic
```

Color resolution for `svg:fill` — walk this chain, stop at first concrete hex value:

1. `topic.style.properties["svg:fill"]` (per-node override)
2. If `"inherited"` → repeat step 1 for parent node, walking up the tree
3. If root reached or still `"inherited"` → use theme class default by depth:
   - depth 0 → `theme.centralTopic`
   - depth 1 → `theme.mainTopic`
   - depth 2+ → `theme.subTopic`
   - floating → `theme.floatingTopic`
4. If topic has a `class` marker: `importantTopic` / `minorTopic` — use those theme entries instead of depth-based
5. If the theme class value is also `"inherited"` → walk up theme hierarchy: `subTopic → mainTopic → centralTopic`
6. If all unresolved — omit color entirely

`"fill-pattern": "none"` → transparent, treat as no color.

### Text color

`fo:color` is mapped to PlantUML's inline markup: `** [#bg] <color:#RRGGBB>text</color>`.
Same resolution chain as `svg:fill`. Only emit if a concrete hex is found (skip `"inherited"`).

### Skipped styles

`fo:font-weight` (bold) and `fo:font-style` (italic) are skipped — PlantUML inline
markup (`**text**`, `//text//`) conflicts with the mindmap level-prefix syntax and
requires escaping topic text, which is not worth the fragility.

## Server Endpoint

`POST /diagrams/xmind/convert`

```
Body: multipart/form-data  { file: <xmind binary> }
Response: { plantumlCode: string }
```

Separate from the attachment upload — caller uploads the attachment independently
and receives `attachmentId`, then calls convert to get `plantumlCode`.

## New Node Attribute

`plantuml` TipTap extension gains one optional attribute:

```ts
xmindAttachmentId: { default: null }   // attachment id of the source .xmind file
xmindModified:    { default: false }   // true after any manual PlantUML edit
```

Both attributes are stored in ProseMirror JSON as-is, no schema changes needed.

## Diagram Type Badge

When a `plantuml` node has `xmindAttachmentId` set, the top-right corner of the
rendered diagram shows the XMind logo (`/icons/xmind-logo.png`, 16×16) instead
of the default PlantUML logo badge. This visually distinguishes XMind mind maps
from hand-written PlantUML diagrams. The badge updates automatically when a node
is converted or re-imported.



- Editing `.xmind` in browser
- Diff / change summary between versions
- Export back to `.xmind`
- Hyperlinks, images, audio notes inside XMind topics
