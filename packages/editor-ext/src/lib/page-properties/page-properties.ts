import { Node, mergeAttributes } from "@tiptap/core";
import type { PageProperty } from "./yaml-utils";

export type { PageProperty };

export interface PagePropertiesOptions {
  HTMLAttributes: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageProperties: {
      /**
       * Delete the pageProperties node if it is the first node.
       * Used by the migration shim in PropertiesPanel.
       */
      deletePageProperties: () => ReturnType;
    };
  }
}

/**
 * Legacy stub — kept so that documents containing a `pageProperties` node
 * are not corrupted while PropertiesPanel migrates them to Y.Map on first open.
 * The NodeView renders a hidden no-op element so the block is invisible.
 */
export const PageProperties = Node.create<PagePropertiesOptions>({
  name: "pageProperties",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {} };
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
    return [{ tag: `div[data-type="${this.name}"]` }];
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

  /** Ghost NodeView — renders nothing, zero height, not interactive. */
  addNodeView() {
    return () => {
      const dom = document.createElement("div");
      dom.setAttribute("data-legacy-properties", "");
      dom.style.cssText = "display:none";
      dom.contentEditable = "false";
      return { dom };
    };
  },

  addCommands() {
    return {
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
