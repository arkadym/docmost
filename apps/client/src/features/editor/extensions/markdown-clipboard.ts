// adapted from: https://github.com/aguingand/tiptap-markdown/blob/main/src/extensions/tiptap/clipboard.js - MIT
import * as Y from "yjs";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser } from "@tiptap/pm/model";
import { find } from "linkifyjs";
import {
  markdownToHtml,
  parseYamlFrontmatter,
  extractFrontmatter,
} from "@docmost/editor-ext";

export const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",
  priority: 101,

  addOptions() {
    return {
      transformPastedText: false,
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("markdownClipboard"),
        props: {
          handlePaste: (view, event, slice) => {
            if (!event.clipboardData) {
              return false;
            }

            if (this.editor.isActive("codeBlock")) {
              return false;
            }

            const text = event.clipboardData.getData("text/plain");

            // Handle YAML frontmatter from ANY source (VS Code, Obsidian, plain text, etc.)
            // This must run before the VS Code language check so it intercepts all pastes.
            const frontmatter = extractFrontmatter(text);
            if (frontmatter) {
              const { tr } = view.state;
              const { from, to } = view.state.selection;
              const properties = parseYamlFrontmatter(frontmatter.yaml);
              if (properties.length > 0) {
                const collabExt = this.editor.extensionManager.extensions.find(
                  (e) => e.name === "collaboration",
                );
                const ydoc = (collabExt as any)?.options?.document as
                  | Y.Doc
                  | undefined;
                if (ydoc) {
                  ydoc.transact(() => {
                    ydoc.getMap("properties").set("data", properties);
                  });
                }
              }
              const bodyHtml = markdownToHtml(frontmatter.body);
              if (frontmatter.body.trim()) {
                const contentNodes = DOMParser.fromSchema(
                  this.editor.schema,
                ).parseSlice(elementFromString(bodyHtml), {
                  preserveWhitespace: true,
                });
                tr.replaceRange(from, to, contentNodes);
                tr.setMeta("paste", true);
                view.dispatch(tr);
              }
              return true;
            }

            const vscode = event.clipboardData.getData("vscode-editor-data");
            const vscodeData = vscode ? JSON.parse(vscode) : undefined;
            const language = vscodeData?.mode;

            if (language !== "markdown") {
              return false;
            }

            const { tr } = view.state;
            const { from, to } = view.state.selection;

            const html = markdownToHtml(text);

            const contentNodes = DOMParser.fromSchema(
              this.editor.schema,
            ).parseSlice(elementFromString(html), {
              preserveWhitespace: true,
            });

            tr.replaceRange(from, to, contentNodes);
            tr.setMeta('paste', true)
            view.dispatch(tr);
            return true;
          },
          clipboardTextParser: (text, context, plainText) => {
            const link = find(text, {
              defaultProtocol: "http",
            }).find((item) => item.isLink && item.value === text);

            if (plainText || !this.options.transformPastedText || link) {
              // don't parse plaintext link to allow link paste handler to work
              // pasting with shift key prevents formatting
              return null;
            }

            const parsed = markdownToHtml(text);
            return DOMParser.fromSchema(this.editor.schema).parseSlice(
              elementFromString(parsed),
              {
                preserveWhitespace: true,
                context,
              },
            );
          },
        },
      }),
    ];
  },
});

function elementFromString(value) {
  // add a wrapper to preserve leading and trailing whitespace
  const wrappedValue = `<body>${value}</body>`;

  return new window.DOMParser().parseFromString(wrappedValue, "text/html").body;
}
