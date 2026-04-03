import { atomWithStorage } from "jotai/utils";

export type SortField = "manual" | "title" | "createdAt" | "updatedAt";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortConfig = { field: "manual", direction: "asc" };

// Per-space sort config. Key: spaceId
export const spaceSortAtom = atomWithStorage<Record<string, SortConfig>>(
  "page-sort-space",
  {},
);

// Per-folder sort config. Key: pageId. null means "inherit from parent".
export const folderSortAtom = atomWithStorage<Record<string, SortConfig | null>>(
  "page-sort-folder",
  {},
);

/**
 * Returns the effective sort for a folder or root level.
 *
 * @param spaceId   - current space id
 * @param pageId    - the folder whose sort we're resolving (null = root level)
 * @param ancestors - ordered list of ancestor pageIds from root → direct parent of pageId
 * @param spaceSorts  - the full spaceSortAtom value
 * @param folderSorts - the full folderSortAtom value
 */
export function getEffectiveSort(
  spaceId: string,
  pageId: string | null,
  ancestors: string[],
  spaceSorts: Record<string, SortConfig>,
  folderSorts: Record<string, SortConfig | null>,
): SortConfig {
  const spaceSort = spaceSorts[spaceId] ?? DEFAULT_SORT;

  if (!pageId) return spaceSort;

  // Walk from closest ancestor (pageId itself) up through ancestors
  const chain = [...ancestors, pageId].reverse();
  for (const id of chain) {
    const folderSort = folderSorts[id];
    if (folderSort !== undefined && folderSort !== null) return folderSort;
  }

  return spaceSort;
}
