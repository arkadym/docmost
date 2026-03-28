import { marked } from "marked";
import { calloutExtension } from "./callout.marked";
import { mathBlockExtension } from "./math-block.marked";
import { mathInlineExtension } from "./math-inline.marked";

marked.use({
  renderer: {
    // @ts-ignore - marked v17 passes a token object; return false falls back to default renderer
    code(token: { text: string; lang?: string }): string | false {
      if (token.lang === 'plantuml') {
        const encodedCode = token.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
        return `<div data-type="plantuml" data-code="${encodedCode}"></div>`;
      }
      return false;
    },
  },
});

marked.use({
  renderer: {
    // @ts-ignore - marked v17 passes the list token object, not positional (body, ordered, start)
    list(token: any): string {
      const isOrdered = token.ordered;
      const start = token.start;
      const items: any[] = token.items || [];
      // Render items via the renderer (respects the listitem override below)
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this as any;
      const body = items.map((item: any) => self.listitem(item)).join('');
      if (isOrdered) {
        const startAttr = start && start !== 1 ? ` start="${start}"` : "";
        return `<ol${startAttr}>\n${body}</ol>\n`;
      }
      const dataType = items.some((item: any) => item.task) ? ' data-type="taskList"' : "";
      return `<ul${dataType}>\n${body}</ul>\n`;
    },
    // @ts-ignore - marked v17 passes a token object
    listitem(token: any): string {
      const isTask = token.task;
      const isChecked = token.checked;
      // Use parser to render child tokens (handles nested lists, bold, etc.)
      const self = this as any;
      const children = self.parser?.parse(token.tokens, !!token.loose) ?? token.text ?? '';
      if (!isTask) {
        return `<li>${children}</li>\n`;
      }
      const checkedAttr = isChecked ? 'data-checked="true"' : 'data-checked="false"';
      return `<li data-type="taskItem" ${checkedAttr}>${children}</li>\n`;
    },
  },
});

marked.use({
  extensions: [calloutExtension, mathBlockExtension, mathInlineExtension],
});

export function markdownToHtml(
  markdownInput: string,
): string | Promise<string> {
  const YAML_FONT_MATTER_REGEX = /^\s*---[\s\S]*?---\s*/;

  const markdown = markdownInput
    .replace(YAML_FONT_MATTER_REGEX, "")
    .trimStart();

  return marked
    .options({ breaks: true })
    .parse(markdown)
    .toString();
}
