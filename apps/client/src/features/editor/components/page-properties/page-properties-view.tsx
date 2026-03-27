import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useCallback, useState } from "react";
import { ActionIcon, Badge, Collapse } from "@mantine/core";
import {
  IconChevronRight,
  IconExternalLink,
  IconPlus,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import type { PageProperty } from "@docmost/editor-ext";
import classes from "./page-properties.module.css";

// ── Smart value renderers ────────────────────────────────────────────────────

/**
 * Try to parse a string as a date.
 * Handles plain ISO strings AND Obsidian's format: "2023-09-07T22:51:46 (UTC +07:00)".
 */
function tryParseDate(value: string): Date | null {
  if (!/\d{4}/.test(value)) return null;

  // Obsidian format: "2023-09-07T22:51:46 (UTC +07:00)"
  // Reconstruct as valid ISO 8601 by extracting the offset and appending it.
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

/** Infer a semantic type from the property key name. */
function inferKeyType(
  key: string,
): "date" | "url" | "author" | "tags" | "default" {
  const k = key.trim().toLowerCase();
  if (k === "created" || k === "date" || k === "updated" || k === "modified")
    return "date";
  if (k === "source" || k === "url" || k === "link" || k === "href")
    return "url";
  if (k === "author" || k === "authors" || k === "creator" || k === "by")
    return "author";
  return "default";
}

export default function PagePropertiesView(props: NodeViewProps) {
  const { node, updateAttributes, editor } = props;
  const properties: PageProperty[] = node.attrs.properties ?? [];
  const [open, setOpen] = useState(true);
  const isEditable = editor.isEditable;

  const setProperties = useCallback(
    (next: PageProperty[]) => {
      updateAttributes({ properties: next });
    },
    [updateAttributes],
  );

  const updateKey = (index: number, newKey: string) => {
    const next = properties.map((p, i) =>
      i === index ? { ...p, key: newKey } : p,
    );
    setProperties(next);
  };

  const updateValue = (index: number, newValue: string) => {
    const prop = properties[index];
    // If the property was an array, stay as array (comma-separated input)
    const isArray = Array.isArray(prop.value);
    const next = properties.map((p, i) =>
      i === index
        ? {
            ...p,
            value: isArray
              ? newValue
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : newValue,
          }
        : p,
    );
    setProperties(next);
  };

  const deleteProperty = (index: number) => {
    setProperties(properties.filter((_, i) => i !== index));
  };

  const addProperty = () => {
    setProperties([...properties, { key: "", value: "" }]);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    index: number,
    field: "key" | "value",
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "key") {
        // Move focus to value input of same row
        const row = (e.currentTarget as HTMLElement).closest("[data-row]");
        (row?.querySelector("[data-value-input]") as HTMLElement)?.focus();
      } else {
        // Add new row and focus its key
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

  const getValueDisplay = (value: string | string[]) => {
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return value;
  };

  /** Render a read-only value with smart formatting based on key name. */
  function ReadOnlyValue({ prop }: { prop: PageProperty }) {
    const keyType = inferKeyType(prop.key);

    // Array → tag badges
    if (Array.isArray(prop.value)) {
      return (
        <>
          {prop.value.map((tag, ti) => (
            <Badge
              key={ti}
              variant="light"
              size="sm"
              tt="none"
              className={classes.tagBadge}
            >
              {tag}
            </Badge>
          ))}
        </>
      );
    }

    const strVal = prop.value as string;

    // Date fields
    if (keyType === "date") {
      return (
        <span className={classes.valueInput} style={{ display: "block" }}>
          {formatDate(strVal)}
        </span>
      );
    }

    // URL fields or values that look like URLs
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

    // Author field
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

  return (
    <NodeViewWrapper contentEditable={false} data-drag-handle="">
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
            {properties.length} {properties.length === 1 ? "field" : "fields"}
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
                        Array.isArray(prop.value) ? "value1, value2, ..." : "Empty"
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
    </NodeViewWrapper>
  );
}
