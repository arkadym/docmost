import { Menu, ActionIcon, rem } from "@mantine/core";
import { IconArrowsUpDown, IconCheck } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import {
  SortConfig,
  SortField,
  SortDirection,
  DEFAULT_SORT,
  folderSortAtom,
  spaceSortAtom,
  getEffectiveSort,
} from "@/features/page/tree/atoms/sort-atom.ts";

interface SortMenuProps {
  /** The space this sort applies to */
  spaceId: string;
  /**
   * The folder (page) this sort is for.
   * null means this is the space-level sort button (no "Default" option shown).
   */
  pageId: string | null;
  /**
   * Ancestor pageIds from root → direct parent of pageId.
   * Used for "Default" label and effective sort resolution.
   */
  ancestors?: string[];
  /** Optional extra Mantine ActionIcon props. Passed through to trigger. */
  variant?: "default" | "transparent";
}

/** Default directions when first selecting a sort field */
const defaultDirectionFor: Record<SortField, SortDirection> = {
  manual: "asc",
  title: "asc",
  createdAt: "desc",
  updatedAt: "desc",
};

export default function SortMenu({
  spaceId,
  pageId,
  ancestors = [],
  variant = "default",
}: SortMenuProps) {
  const { t } = useTranslation();
  const [spaceSorts, setSpaceSorts] = useAtom(spaceSortAtom);
  const [folderSorts, setFolderSorts] = useAtom(folderSortAtom);

  const spaceSort = spaceSorts[spaceId] ?? DEFAULT_SORT;

  const currentSort: SortConfig = pageId
    ? getEffectiveSort(spaceId, pageId, ancestors, spaceSorts, folderSorts)
    : spaceSort;

  // Whether this folder/space has an explicit (non-inherited) sort set
  const hasExplicitSort: boolean = pageId
    ? folderSorts[pageId] !== undefined && folderSorts[pageId] !== null
    : !!spaceSorts[spaceId];

  function applySort(field: SortField, direction?: SortDirection) {
    let dir: SortDirection;
    if (direction !== undefined) {
      dir = direction;
    } else if (currentSort.field === field) {
      // toggle direction on re-click
      dir = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      dir = defaultDirectionFor[field];
    }

    const newSort: SortConfig = { field, direction: dir };

    if (pageId) {
      setFolderSorts((prev) => ({ ...prev, [pageId]: newSort }));
    } else {
      setSpaceSorts((prev) => ({ ...prev, [spaceId]: newSort }));
    }
  }

  function clearFolderSort() {
    if (!pageId) return;
    setFolderSorts((prev) => ({ ...prev, [pageId]: null }));
  }

  function labelFor(field: SortField, direction: SortDirection): string {
    if (field === "manual") return t("Sort: Manual");
    if (field === "title")
      return direction === "asc" ? t("Sort: Title A-Z") : t("Sort: Title Z-A");
    if (field === "createdAt")
      return direction === "asc"
        ? t("Sort: Created Oldest")
        : t("Sort: Created Newest");
    // updatedAt
    return direction === "asc"
      ? t("Sort: Updated Oldest")
      : t("Sort: Updated Newest");
  }

  /** Inherited sort label shown alongside "Default" menu item */
  function inheritedSortLabel(): string {
    const inherited = getEffectiveSort(
      spaceId,
      // resolve as if no folder override — use parent
      ancestors.length > 0 ? ancestors[ancestors.length - 1] : null,
      ancestors.slice(0, -1),
      spaceSorts,
      folderSorts,
    );
    return labelFor(inherited.field, inherited.direction);
  }

  const isActive = (field: SortField) =>
    hasExplicitSort && currentSort.field === field;

  const iconSize = rem(20);

  return (
    <Menu shadow="md" width={200} position="bottom-end">
      <Menu.Target>
        <ActionIcon
          variant={variant}
          c={variant === "transparent" ? "gray" : undefined}
          size={variant === "default" ? 18 : undefined}
          aria-label={t("Sort pages")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <IconArrowsUpDown
            style={
              variant === "transparent"
                ? { width: iconSize, height: iconSize }
                : undefined
            }
            stroke={2}
          />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown>
        {/* Default (inherit) option — only for folder-level menus */}
        {pageId && (
          <>
            <Menu.Item
              leftSection={!hasExplicitSort ? <IconCheck size={16} /> : <span style={{ width: 16 }} />}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearFolderSort();
              }}
            >
              {t("Sort: Default")} ({inheritedSortLabel()})
            </Menu.Item>
            <Menu.Divider />
          </>
        )}

        <Menu.Item
          leftSection={
            isActive("manual") ? (
              <IconCheck size={16} />
            ) : (
              <span style={{ width: 16 }} />
            )
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applySort("manual");
          }}
        >
          {t("Sort: Manual")}
        </Menu.Item>

        <Menu.Item
          leftSection={
            isActive("title") ? (
              <IconCheck size={16} />
            ) : (
              <span style={{ width: 16 }} />
            )
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applySort("title");
          }}
        >
          {labelFor(
            "title",
            currentSort.field === "title" ? currentSort.direction : defaultDirectionFor.title,
          )}
        </Menu.Item>

        <Menu.Item
          leftSection={
            isActive("createdAt") ? (
              <IconCheck size={16} />
            ) : (
              <span style={{ width: 16 }} />
            )
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applySort("createdAt");
          }}
        >
          {labelFor(
            "createdAt",
            currentSort.field === "createdAt"
              ? currentSort.direction
              : defaultDirectionFor.createdAt,
          )}
        </Menu.Item>

        <Menu.Item
          leftSection={
            isActive("updatedAt") ? (
              <IconCheck size={16} />
            ) : (
              <span style={{ width: 16 }} />
            )
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applySort("updatedAt");
          }}
        >
          {labelFor(
            "updatedAt",
            currentSort.field === "updatedAt"
              ? currentSort.direction
              : defaultDirectionFor.updatedAt,
          )}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
