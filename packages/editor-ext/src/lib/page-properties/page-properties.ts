import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { PageProperty } from "./yaml-utils";

export type { PageProperty };

export interface PagePropertiesOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageProperties: {
      /**
       * Insert a pageProperties node at the beginning of the document,
       * or update the existing one if it is already the first node.
       */
      insertPageProperties: (properties: PageProperty[]) => ReturnType;
      /**
       * Update the properties attribute on an existing pageProperties node.
       */
      updatePageProperties: (properties: PageProperty[]) => ReturnType;
      /**
       * Delete the pageProperties node if it is the first node.
       */
      deletePageProperties: () => ReturnType;
    };
  }
}

export const PageProperties = Node.create<PagePropertiesOptions>({
  name: "pageProperties",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },

  addAttributes() {
    return {
      properties: {
        default: [],
        parseHTML: (element) => {
          try {
            return JSON.parse(element.getAttribute("data-properties") || "[]");
          } catch {
            return [];
          }
        },
        renderHTML: (attributes) => ({
          "data-properties": JSON.stringify(attributes.properties),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        { "data-type": this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
    ];
  },

  addNodeView() {
    if (!this.options.view) return null;
    return ReactNodeViewRenderer(this.options.view);
  },

  addCommands() {
    return {
      insertPageProperties:
        (properties) =>
        ({ commands, state }) => {
          const firstNode = state.doc.firstChild;
          if (firstNode?.type.name === "pageProperties") {
            return commands.updateAttributes("pageProperties", { properties });
          }
          return commands.insertContentAt(0, {
            type: this.name,
            attrs: { properties },
          });
        },

      updatePageProperties:
        (properties) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { properties });
        },

      deletePageProperties:
        () =>
        ({ commands, state }) => {
          if (state.doc.firstChild?.type.name === "pageProperties") {
            return commands.deleteNode(this.name);
          }
          return false;
        },
    };
  },
});
