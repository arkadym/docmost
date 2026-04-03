// adapted from: https://github.com/aguingand/tiptap-markdown/blob/main/src/extensions/tiptap/clipboard.js - MIT
import * as Y from "yjs";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { DOMParser, DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import { find } from "linkifyjs";
import {
  markdownToHtml,
  htmlToMarkdown,
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
          clipboardTextSerializer: (slice) => {
            const listTypes = ["bulletList", "orderedList", "taskList"];
            let topLevelCount = 0;
            let hasList = false;
            slice.content.forEach((node) => {
              if (listTypes.includes(node.type.name)) {
                hasList = true;
                topLevelCount += node.childCount;
              } else {
                topLevelCount++;
              }
            });

            if (!hasList || topLevelCount < 2) return null;

            const div = document.createElement("div");
            const serializer = DOMSerializer.fromSchema(this.editor.schema);
            const fragment = serializer.serializeFragment(slice.content);
            div.appendChild(fragment);
            return htmlToMarkdown(div.innerHTML);
          },
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

            const html = event.clipboardData.getData("text/html");
            const vscode = event.clipboardData.getData("vscode-editor-data");
            const vscodeData = vscode ? JSON.parse(vscode) : undefined;
            const language = vscodeData?.mode;

            const isVscodeMarkdown = language === "markdown";
            const isPlainTextOnly = !html && !vscode && !!text;
            // Force markdown processing when the text contains custom fenced blocks
            // (e.g. plantuml), so ProseMirror doesn't silently discard the code fence.
            const hasCustomFence = /^```plantuml\b/m.test(text);

            if (!isVscodeMarkdown && !isPlainTextOnly && !hasCustomFence) {
              return false;
            }

            if (isPlainTextOnly) {
              if ((view as any).input?.shiftKey || !this.options.transformPastedText) {
                return false;
              }

              const link = find(text, {
                defaultProtocol: "http",
              }).find((item) => item.isLink && item.value === text);

              if (link) {
                return false;
              }
            }

            const { tr } = view.state;
            const { from, to } = view.state.selection;

            const parsed = markdownToHtml(text.replace(/\n+$/, ""));

            const contentNodes = DOMParser.fromSchema(
              this.editor.schema,
            ).parseSlice(elementFromString(parsed), {
              preserveWhitespace: true,
            });

            tr.replaceRange(from, to, contentNodes);
            const insertEnd = tr.mapping.map(from, 1);
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(from, insertEnd - 2)), -1));
            tr.setMeta('paste', true)
            view.dispatch(tr);
            return true;
          },
          // Strip trailing whitespace-only paragraphs from pasted content.
          // Terminals (GNOME Terminal, etc.) often include trailing
          // whitespace in their HTML clipboard data, which ProseMirror
          // parses as an extra paragraph. Inside a list item this creates
          // an orphan empty line that breaks the list structure.
          transformPasted: (slice) => {
            let { content, openStart, openEnd } = slice;

            // Remove trailing paragraphs that contain only whitespace
            while (content.childCount > 1) {
              const lastChild = content.lastChild;
              if (
                lastChild?.type.name === "paragraph" &&
                lastChild.textContent.trim() === ""
              ) {
                const children = [];
                for (let i = 0; i < content.childCount - 1; i++) {
                  children.push(content.child(i));
                }
                content = Fragment.from(children);
              } else {
                break;
              }
            }

            if (content !== slice.content) {
              return new Slice(content, openStart, Math.max(openEnd, 1));
            }

            return slice;
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
