export interface PageProperty {
  key: string;
  value: string | string[];
}

/**
 * Minimal YAML frontmatter parser that handles the common cases:
 * - Simple strings:  key: value
 * - Quoted strings:  key: "value" or key: 'value'
 * - Block arrays:    key:\n  - item1\n  - item2
 * - Inline arrays:   key: [item1, item2]
 */
export function parseYamlFrontmatter(yaml: string): PageProperty[] {
  const result: PageProperty[] = [];
  const lines = yaml.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_\s-]*):\s*(.*)?$/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1].trim();
    const rest = (keyMatch[2] ?? "").trim();

    if (rest === "") {
      // Could be a block array (next lines start with "  - ")
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+(.+)$/.test(lines[i])) {
        const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
        if (itemMatch) items.push(itemMatch[1].trim());
        i++;
      }
      if (items.length > 0) {
        result.push({ key, value: items });
      } else {
        result.push({ key, value: "" });
      }
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      // Inline array: [item1, item2, item3]
      const items = rest
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      result.push({ key, value: items });
      i++;
    } else {
      // Simple value (possibly quoted)
      let value = rest;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result.push({ key, value });
      i++;
    }
  }

  return result;
}

/**
 * Converts a properties array back to YAML frontmatter string.
 */
export function stringifyYamlFrontmatter(properties: PageProperty[]): string {
  if (properties.length === 0) return "";

  const lines = properties
    .filter((p) => p.key.trim())
    .map(({ key, value }) => {
      if (Array.isArray(value)) {
        if (value.length === 0) return `${key}:`;
        return `${key}:\n${value.map((v) => `  - ${v}`).join("\n")}`;
      }
      // Quote if value contains characters special to YAML
      const needsQuote =
        /^[{[\|>&*!%#@`'"]/.test(value) ||
        value.includes(": ") ||
        value.startsWith(" ") ||
        value.endsWith(" ");
      const quoted = needsQuote
        ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : value;
      return `${key}: ${quoted}`;
    });

  return `---\n${lines.join("\n")}\n---`;
}

/**
 * Extracts the YAML frontmatter block from a markdown string.
 * Returns null if no frontmatter found.
 */
export function extractFrontmatter(
  markdown: string,
): { yaml: string; body: string } | null {
  const match = markdown.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { yaml: match[1], body: match[2] };
}
