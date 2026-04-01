import * as Y from "yjs";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Collapse } from "@mantine/core";
import {
  IconChevronRight,
  IconExternalLink,
  IconLayoutList,
  IconPlus,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import type { PageProperty } from "@docmost/editor-ext";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms";
import classes from "./page-properties.module.css";

// ── Y.Map key ───────────────────────────────────────────────────────────────

const MAP_NAME = "properties";
const DATA_KEY = "data";

// ── Smart value renderers (same as before) ───────────────────────────────────

function tryParseDate(value: string): Date | null {
  if (!/\d{4}/.test(value)) return null;
  const obsidianMatch = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s*\(UTC\s*([+-]\d{2}:\d{2})\)$/,
  );
  if (obsidianMatch) {
    const d = new Date(`${obsidianMatch[1]}${obsidianMatch[2]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(value: string): string {
  const d = tryParseDate(value);
  if (!d) return value;
  return new Intl.DateTimeFormat(navigator.language, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function inferKeyType(key: string): "date" | "url" | "author" | "default" {
  const k = key.trim().toLowerCase();
  if (k === "created" || k === "date" || k === "updated" || k === "modified")
    return "date";
  if (k === "source" || k === "url" || k === "link" || k === "href")
    return "url";
  if (k === "author" || k === "authors" || k === "creator" || k === "by")
    return "author";
  return "default";
}

function ReadOnlyValue({ prop }: { prop: PageProperty }) {
  const keyType = inferKeyType(prop.key);

  if (Array.isArray(prop.value)) {
    return (
      <>
        {prop.value.map((tag, ti) => (
          <Badge key={ti} variant="light" size="sm" tt="none" className={classes.tagBadge}>
            {tag}
          </Badge>
        ))}
      </>
    );
  }

  const strVal = prop.value as string;

  if (keyType === "date") {
    return (
      <span className={classes.valueInput} style={{ display: "block" }}>
        {formatDate(strVal)}
      </span>
    );
  }

  if (keyType === "url" || isUrl(strVal)) {
    return (
      <a
        href={strVal}
        target="_blank"
        rel="noopener noreferrer"
        className={classes.valueLink}
      >
        <IconExternalLink size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
        {strVal}
      </a>
    );
  }

  if (keyType === "author") {
    return (
      <span className={classes.authorChip}>
        <IconUser size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
        {strVal}
      </span>
    );
  }

  return (
    <span className={classes.valueInput} style={{ display: "block" }}>
      {strVal}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface PropertiesPanelProps {
  editable: boolean;
  ydoc: Y.Doc | null;
}

export default function PropertiesPanel({ editable, ydoc }: PropertiesPanelProps) {
  const editor = useAtomValue(pageEditorAtom);
  const isEditable = editable && (editor?.isEditable ?? false);

  const [properties, setProperties] = useState<PageProperty[]>([]);
  const [open, setOpen] = useState(true);
  const migratedRef = useRef(false);
  // True once at least one ydoc update has arrived — proof the doc has loaded.
  const ydocSyncedRef = useRef(false);

  // ── Sync from Y.Map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!ydoc) return;

    const map = ydoc.getMap(MAP_NAME);

    const sync = () => {
      const data = (map.get(DATA_KEY) ?? []) as PageProperty[];
      setProperties(data);
    };

    sync();
    map.observe(sync);
    return () => map.unobserve(sync);
  }, [ydoc]);

  // ── Lazy migration from legacy pageProperties ProseMirror node ───────────
  useEffect(() => {
    if (!ydoc || !editor) return;

    // Reset per ydoc/editor instance
    ydocSyncedRef.current = false;

    const runMigration = () => {
      if (migratedRef.current) return;

      const map = ydoc.getMap(MAP_NAME);
      const alreadyMigrated =
        ((map.get(DATA_KEY) ?? []) as PageProperty[]).length > 0;

      if (alreadyMigrated) {
        migratedRef.current = true;
        return;
      }

      const firstNode = editor.state.doc.firstChild;
      if (firstNode?.type.name === "pageProperties") {
        const legacyProps: PageProperty[] = firstNode.attrs.properties ?? [];
        migratedRef.current = true;
        if (legacyProps.length > 0) {
          ydoc.transact(() => {
            map.set(DATA_KEY, legacyProps);
          });
        }
        editor.commands.deletePageProperties();
      } else if (ydocSyncedRef.current) {
        // Doc has had at least one ydoc update — safely no legacy node.
        migratedRef.current = true;
      }
      // else: ydoc not yet synced; wait for the first update event below.
    };

    const onUpdate = () => {
      ydocSyncedRef.current = true;
      runMigration();
    };

    ydoc.on("update", onUpdate);
    return () => ydoc.off("update", onUpdate);
  }, [ydoc, editor]);

  // ── Write helpers ────────────────────────────────────────────────────────
  const persistProperties = useCallback(
    (next: PageProperty[]) => {
      if (!ydoc) return;
      const map = ydoc.getMap(MAP_NAME);
      if (next.length === 0) {
        ydoc.transact(() => map.delete(DATA_KEY));
      } else {
        ydoc.transact(() => map.set(DATA_KEY, next));
      }
    },
    [ydoc],
  );

  const updateKey = (index: number, newKey: string) => {
    persistProperties(
      properties.map((p, i) => (i === index ? { ...p, key: newKey } : p)),
    );
  };

  const updateValue = (index: number, newValue: string) => {
    const prop = properties[index];
    const isArray = Array.isArray(prop.value);
    persistProperties(
      properties.map((p, i) =>
        i === index
          ? {
              ...p,
              value: isArray
                ? newValue.split(",").map((s) => s.trim()).filter(Boolean)
                : newValue,
            }
          : p,
      ),
    );
  };

  const deleteProperty = (index: number) => {
    persistProperties(properties.filter((_, i) => i !== index));
  };

  const addProperty = () => {
    persistProperties([...properties, { key: "", value: "" }]);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    index: number,
    field: "key" | "value",
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "key") {
        const row = (e.currentTarget as HTMLElement).closest("[data-row]");
        (row?.querySelector("[data-value-input]") as HTMLElement)?.focus();
      } else {
        addProperty();
        setTimeout(() => {
          const rows = document.querySelectorAll("[data-row]");
          const lastRow = rows[rows.length - 1];
          (lastRow?.querySelector("[data-key-input]") as HTMLElement)?.focus();
        }, 50);
      }
    }
    if (e.key === "Escape") {
      (e.currentTarget as HTMLElement).blur();
    }
    if (e.key === "Backspace") {
      const input = e.currentTarget as HTMLInputElement;
      if (input.value === "" && field === "key") {
        e.preventDefault();
        deleteProperty(index);
      }
    }
  };

  const getValueDisplay = (value: string | string[]) =>
    Array.isArray(value) ? value.join(", ") : value;

  // ── Render ───────────────────────────────────────────────────────────────

  if (!ydoc) return null;

  const hasProperties = properties.length > 0;

  // Nothing to show in read mode when no properties
  if (!hasProperties && !isEditable) return null;

  // "Add properties" prompt when no properties yet, editable mode
  if (!hasProperties) {
    return (
      <div className={classes.outerWrapper}>
        <button className={classes.addPropertiesBtn} onClick={() => addProperty()}>
          <IconLayoutList size={14} />
          Add properties
        </button>
      </div>
    );
  }

  return (
    <div className={classes.outerWrapper}>
      <div className={classes.container}>
        {/* Header */}
        <div
          className={classes.header}
          onClick={() => setOpen((o) => !o)}
          data-properties-header
        >
          <IconChevronRight
            size={14}
            className={`${classes.chevron} ${open ? classes.chevronOpen : ""}`}
          />
          <span>Properties</span>
          <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.6 }}>
            {properties.length}{" "}
            {properties.length === 1 ? "field" : "fields"}
          </span>
        </div>

        {/* Body */}
        <Collapse in={open}>
          <div className={classes.body}>
            {properties.length > 0 && <div className={classes.divider} />}

            {properties.map((prop, index) => (
              <div className={classes.row} key={index} data-row>
                {/* Key cell */}
                <div className={classes.keyCell}>
                  <input
                    className={classes.keyInput}
                    value={prop.key}
                    readOnly={!isEditable}
                    placeholder="Property name"
                    data-key-input
                    onChange={(e) => updateKey(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, "key")}
                  />
                </div>

                {/* Value cell */}
                <div className={classes.valueCell}>
                  {isEditable ? (
                    <input
                      className={classes.valueInput}
                      value={getValueDisplay(prop.value)}
                      placeholder={
                        Array.isArray(prop.value)
                          ? "value1, value2, ..."
                          : "Empty"
                      }
                      data-value-input
                      onChange={(e) => updateValue(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, index, "value")}
                    />
                  ) : (
                    <ReadOnlyValue prop={prop} />
                  )}
                </div>

                {/* Delete button */}
                {isEditable && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="xs"
                    className={classes.deleteBtn}
                    onClick={() => deleteProperty(index)}
                    aria-label="Delete property"
                  >
                    <IconX size={12} />
                  </ActionIcon>
                )}
              </div>
            ))}

            {/* Add property */}
            {isEditable && (
              <div className={classes.addRow}>
                <button className={classes.addBtn} onClick={addProperty}>
                  <IconPlus size={13} />
                  Add property
                </button>
              </div>
            )}
          </div>
        </Collapse>
      </div>
    </div>
  );
}
