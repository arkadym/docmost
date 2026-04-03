# Page Sorting Feature

## Overview

Add a sort button to the sidebar that lets users control the order of pages in each space and each folder. Sort preference is persisted per-space and per-folder in `localStorage` via Jotai atoms.

---

## Sort Options

| Option | Field | Default direction |
|---|---|---|
| Manual | `position` (fractional index) | asc (drag-drop order) |
| Title | `title` | asc (A→Z) |
| Created | `createdAt` | desc (Newest first) |
| Updated | `updatedAt` | desc (Newest first) |

### Menu item labels

Menu items show the current active state. The active item reflects the current field + direction:

- **Manual** — only one direction; label: `Manual`
- **Title** — label: `Title (A-Z)` or `Title (Z-A)`
- **Created** — label: `Created (Newest)` or `Created (Oldest)`
- **Updated** — label: `Updated (Newest)` or `Updated (Oldest)`

### Click behavior

- Click a **non-active** sort option → apply it with its default direction
- Click the **already-active** option → toggle direction (asc ↔ desc)
- `Manual` has no toggle (fractional position only has one meaningful order)

---

## Inheritance Model

Sort preference is hierarchical and cascades through the tree:

```
Space sort (default: Manual)
  └── Folder A  ← if no override, inherits Space sort
       └── Folder B  ← if no override, inherits Folder A's effective sort
            └── Folder C  ← if no override, inherits Folder B's effective sort
```

**Inheritance is from the nearest parent** — each folder walks up the tree until it finds an ancestor with an explicit sort set, falling back to the space sort if none is found.

Folder sort menu has an extra first option:

- **Default** — removes the folder-specific override, inherits from parent folder (or space)
  - Label shows the effective inherited sort in parens: `Default (Title A-Z)`

Space sort menu has no "Default" option (it is the root default).

---

## State Management

### Atom structure

```typescript
// apps/client/src/features/page/tree/atoms/sort-atom.ts

import { atomWithStorage } from "jotai/utils";

export type SortField = "manual" | "title" | "createdAt" | "updatedAt";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// Key: spaceId  →  Value: SortConfig
// Default (when key absent) = { field: "manual", direction: "asc" }
export const spaceSortAtom = atomWithStorage<Record<string, SortConfig>>(
  "page-sort-space",
  {},
);

// Key: pageId (folder)  →  Value: SortConfig | null (null = inherit from space)
// Default (when key absent) = null
export const folderSortAtom = atomWithStorage<Record<string, SortConfig | null>>(
  "page-sort-folder",
  {},
);
```

### Resolving effective sort config

Requires access to the tree node data to walk ancestors.

```typescript
// Utility — resolves what sort applies to a given folder/root context
// ancestors: ordered array of pageIds from root → direct parent of pageId
function getEffectiveSort(
  spaceId: string,
  pageId: string | null,         // null = root level
  ancestors: string[],           // [rootAncestor, ..., directParent]
  spaceSorts: Record<string, SortConfig>,
  folderSorts: Record<string, SortConfig | null>,
): SortConfig {
  const spaceDefault: SortConfig = { field: "manual", direction: "asc" };
  const spaceSort = spaceSorts[spaceId] ?? spaceDefault;

  if (!pageId) return spaceSort; // root level uses space sort

  // Check the folder itself first, then walk up through ancestors
  const chain = [...ancestors, pageId].reverse(); // closest first
  for (const id of chain) {
    const sort = folderSorts[id];
    if (sort !== undefined && sort !== null) return sort;
  }
  return spaceSort; // fallback to space sort
}
```

---

## UI Placement

### Space-level button

Location: **"Pages" header** in `space-sidebar.tsx`, between `SpaceMenu` (the `...` dots) and the `+` new page button.

```tsx
// variant="default" size={18} — matches existing IconDots and IconPlus buttons
<Tooltip label={t("Sort pages")} withArrow position="top">
  <ActionIcon
    variant="default"
    size={18}
    aria-label={t("Sort pages")}
  >
    <IconArrowsUpDown />
  </ActionIcon>
</Tooltip>
```

Icon: `IconArrowsUpDown` from `@tabler/icons-react` (confirmed in v3.40.0).

### Folder-level button

Location: **Node action row** in `space-tree.tsx`, between `NodeMenu` (`IconDotsVertical`) and `CreateNode` (`IconPlus`).

```tsx
// variant="transparent" c="gray" — matches existing folder action buttons
<ActionIcon
  variant="transparent"
  c="gray"
  onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSortMenu(); }}
>
  <IconArrowsUpDown style={{ width: rem(20), height: rem(20) }} stroke={2} />
</ActionIcon>
```

The folder sort button should follow the same show-on-hover visibility pattern as the existing `+` and `...` buttons.

---

## Sort Logic

Sort is applied **client-side** on the flat `IPage[]` / `SpaceTreeNode[]` array before it is put into `treeDataAtom`. This avoids changing cursor-based server pagination.

### Sort function

```typescript
// apps/client/src/features/page/tree/utils/sort-pages.ts

import { SortConfig } from "../atoms/sort-atom";
import { SpaceTreeNode } from "../types";

export function sortNodes(
  nodes: SpaceTreeNode[],
  sort: SortConfig,
): SpaceTreeNode[] {
  if (sort.field === "manual") return nodes; // already ordered by position from server

  return [...nodes].sort((a, b) => {
    let cmp = 0;
    if (sort.field === "title") {
      cmp = (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
      });
    } else if (sort.field === "createdAt") {
      cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sort.field === "updatedAt") {
      cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
}
```

### Where sort is applied

Two insertion points in `space-tree.tsx`:

1. **Root pages loaded** (`useEffect` on `pagesData`):
   ```typescript
   const treeData = buildTree(allItems);
   const sorted = sortNodes(treeData, effectiveSort); // apply space-level sort
   setData(...sorted);
   ```

2. **Folder children loaded** (`handleLoadChildren`):
   ```typescript
   const childrenTree = await fetchAllAncestorChildren(params);
   const sorted = sortNodes(childrenTree, effectiveSort); // apply folder/space sort
   appendChildren({ parentId: node.data.id, children: sorted });
   ```

Whenever the user changes sort preference, `treeDataAtom` should be reset so pages re-sort. Simplest way: invalidate / re-fetch the react-query cache for `root-sidebar-pages` and `sidebar-pages` for that space. This triggers the existing `useEffect` which reloads and rebuilds the tree.

---

## Server Changes

The sidebar pages query currently selects:
```
id, slugId, title, icon, position, parentPageId, spaceId, creatorId, deletedAt
```

Need to add `createdAt` and `updatedAt` so the client can sort by them.

**File:** `apps/server/src/core/page/services/page.service.ts` — `getSidebarPages()`

```typescript
.select([
  'id',
  'slugId',
  'title',
  'icon',
  'position',
  'parentPageId',
  'spaceId',
  'creatorId',
  'createdAt',    // ← add
  'updatedAt',    // ← add
  'deletedAt',
])
```

**File:** `apps/client/src/features/page/tree/types.ts` — add to `SpaceTreeNode`:

```typescript
export type SpaceTreeNode = {
  id: string;
  slugId: string;
  name: string;
  icon?: string;
  position: string;
  spaceId: string;
  parentPageId: string;
  hasChildren: boolean;
  canEdit?: boolean;
  createdAt: string;    // ← add
  updatedAt: string;    // ← add
  children: SpaceTreeNode[];
};
```

---

## Files to Create / Modify

### New files

| File | Purpose |
|---|---|
| `apps/client/src/features/page/tree/atoms/sort-atom.ts` | `spaceSortAtom`, `folderSortAtom` |
| `apps/client/src/features/page/tree/utils/sort-pages.ts` | `sortNodes()` helper |
| `apps/client/src/features/page/tree/components/sort-menu.tsx` | Reusable sort dropdown menu component used by both space-level and folder-level buttons |

### Modified files

| File | Change |
|---|---|
| `apps/client/src/features/page/tree/types.ts` | Add `createdAt`, `updatedAt` to `SpaceTreeNode` |
| `apps/client/src/features/space/components/sidebar/space-sidebar.tsx` | Add sort button + `SortMenu` between `SpaceMenu` and `+` |
| `apps/client/src/features/page/tree/components/space-tree.tsx` | Apply sort after `buildTree` and after `appendChildren`; add folder sort button in `Node` |
| `apps/server/src/core/page/services/page.service.ts` | Add `createdAt`, `updatedAt` to sidebar pages select |

---

## SortMenu Component Design

A single `<SortMenu>` component handles both space-level and folder-level menus, configured by props.

```tsx
interface SortMenuProps {
  spaceId: string;
  pageId: string | null;   // null = space-level menu (no "Default" option)
  target: ReactNode;       // the ActionIcon trigger
}
```

Menu items are generated from current sort state. The active item is visually indicated (e.g. checkmark or bold). Clicking the active item toggles direction; clicking another item sets it with its default direction.

---

## Locale keys to add

```
"Sort pages": "Sort pages"
"Manual": "Manual"
"Title (A-Z)": "Title (A-Z)"
"Title (Z-A)": "Title (Z-A)"
"Created (Newest)": "Created (Newest)"
"Created (Oldest)": "Created (Oldest)"
"Updated (Newest)": "Updated (Newest)"
"Updated (Oldest)": "Updated (Oldest)"
"Default": "Default"
```
