import { Node, mergeAttributes, ResizableNodeView } from '@tiptap/core';
import type { ResizableNodeViewDirection } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { normalizeFileUrl } from './media-utils';

export type PlantUmlResizeOptions = {
  enabled: boolean;
  directions?: ResizableNodeViewDirection[];
  minWidth?: number;
  minHeight?: number;
  alwaysPreserveAspectRatio?: boolean;
  createCustomHandle?: (direction: ResizableNodeViewDirection) => HTMLElement;
  className?: {
    container?: string;
    wrapper?: string;
    handle?: string;
    resizing?: string;
  };
};

export interface PlantUmlOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
  resize: PlantUmlResizeOptions | false;
}

export interface PlantUmlAttributes {
  code?: string;
  src?: string;
  title?: string;
  size?: number;
  width?: number | string;
  height?: number;
  aspectRatio?: number;
  align?: string;
  attachmentId?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    plantuml: {
      setPlantUml: (attributes?: PlantUmlAttributes) => ReturnType;
      setPlantUmlAlign: (align: 'left' | 'center' | 'right') => ReturnType;
      setPlantUmlSize: (width: number, height: number) => ReturnType;
    };
  }
}

export const PlantUml = Node.create<PlantUmlOptions>({
  name: 'plantuml',
  inline: false,
  group: 'block',
  isolating: true,
  atom: true,
  defining: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
      resize: false,
    };
  },

  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-code'),
        renderHTML: (attributes) => ({ 'data-code': attributes.code }),
      },
      src: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-src'),
        renderHTML: (attributes) => ({ 'data-src': attributes.src }),
      },
      title: {
        default: undefined,
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: (attributes) => ({ 'data-title': attributes.title }),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-width');
          if (!raw) return null;
          if (raw.endsWith('%')) return raw;
          const num = parseFloat(raw);
          return isNaN(num) ? null : num;
        },
        renderHTML: (attributes) => ({ 'data-width': attributes.width }),
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-height');
          if (!raw) return null;
          const num = parseFloat(raw);
          return isNaN(num) ? null : num;
        },
        renderHTML: (attributes) => ({ 'data-height': attributes.height }),
      },
      size: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-size'),
        renderHTML: (attributes) => ({ 'data-size': attributes.size }),
      },
      aspectRatio: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-aspect-ratio'),
        renderHTML: (attributes) => ({
          'data-aspect-ratio': attributes.aspectRatio,
        }),
      },
      align: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align'),
        renderHTML: (attributes) => ({ 'data-align': attributes.align }),
      },
      attachmentId: {
        default: undefined,
        parseHTML: (element) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes) => ({
          'data-attachment-id': attributes.attachmentId,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-type="${this.name}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-type': this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      [
        'img',
        {
          src: HTMLAttributes['data-src'],
          alt: HTMLAttributes['data-title'],
          width: HTMLAttributes['data-width'],
        },
      ],
    ];
  },

  addCommands() {
    return {
      setPlantUml:
        (attrs?: PlantUmlAttributes) =>
        ({ commands }) => {
          return commands.insertContent({ type: 'plantuml', attrs: attrs ?? {} });
        },

      setPlantUmlAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes('plantuml', { align }),

      setPlantUmlSize:
        (width, height) =>
        ({ commands }) =>
          commands.updateAttributes('plantuml', { width, height }),
    };
  },

  addNodeView() {
    const resize = this.options.resize;

    const {
      directions,
      minWidth,
      minHeight,
      alwaysPreserveAspectRatio,
      createCustomHandle,
      className,
    } = (resize || {}) as PlantUmlResizeOptions;

    return (props: any) => {
      const { node, getPos, editor } = props;

      if (!node.attrs.src) {
        editor.isInitialized = true;
        const reactView = ReactNodeViewRenderer(this.options.view);
        const view = reactView(props);

        const originalUpdate = view.update?.bind(view);
        view.update = (updatedNode: any, decorations: any, innerDecorations: any) => {
          if (updatedNode.attrs.src && !node.attrs.src) {
            return false;
          }
          if (originalUpdate) {
            return originalUpdate(updatedNode, decorations, innerDecorations);
          }
          return true;
        };

        return view;
      }

      const el = document.createElement('img');
      el.src = normalizeFileUrl(node.attrs.src);
      el.alt = node.attrs.title || '';
      el.style.display = 'block';
      el.style.maxWidth = '100%';
      el.style.borderRadius = '8px';

      if (typeof node.attrs.width === 'number' && node.attrs.width > 0) {
        el.style.width = `${node.attrs.width}px`;
        if (typeof node.attrs.height === 'number' && node.attrs.height > 0) {
          el.style.height = `${node.attrs.height}px`;
        }
      }

      let currentNode = node;

      const resizeEnabled = resize && resize.enabled;

      if (!resizeEnabled) {
        // No resize — plain img wrapped in a div by ProseMirror
        const wrapper = document.createElement('div');
        wrapper.appendChild(el);
        applyAlignment(wrapper, node.attrs.align || 'center');
        return {
          dom: wrapper,
          contentDOM: undefined,
          update: (updatedNode: any) => {
            if (updatedNode.type !== currentNode.type) return false;
            if (updatedNode.attrs.src !== currentNode.attrs.src) {
              el.src = normalizeFileUrl(updatedNode.attrs.src);
            }
            applyAlignment(wrapper, updatedNode.attrs.align || 'center');
            currentNode = updatedNode;
            return true;
          },
        };
      }

      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (w: number, h: number) => {
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        },
        onCommit: () => {
          const pos = getPos();
          if (pos === undefined) return;

          this.editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes(this.name, {
              width: Math.round(el.offsetWidth),
              height: Math.round(el.offsetHeight),
            })
            .run();
        },
        onUpdate: (updatedNode: any, _decorations: any, _innerDecorations: any) => {
          if (updatedNode.type !== currentNode.type) {
            return false;
          }

          if (updatedNode.attrs.src !== currentNode.attrs.src) {
            el.src = normalizeFileUrl(updatedNode.attrs.src);
          }

          const w = updatedNode.attrs.width;
          const h = updatedNode.attrs.height;
          if (w != null) {
            el.style.width = `${w}px`;
          }
          if (h != null) {
            el.style.height = `${h}px`;
          }

          const align = updatedNode.attrs.align || 'center';
          const container = nodeView.dom as HTMLElement;
          applyAlignment(container, align);

          currentNode = updatedNode;
          return true;
        },
        options: {
          directions,
          min: {
            width: minWidth,
            height: minHeight,
          },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
          createCustomHandle,
          className,
        },
      });

      const dom = nodeView.dom as HTMLElement;
      applyAlignment(dom, node.attrs.align || 'center');

      // Handle percentage width backward compat
      const widthAttr = node.attrs.width;
      if (typeof widthAttr === 'string' && widthAttr.endsWith('%')) {
        requestAnimationFrame(() => {
          const parentEl = dom.parentElement;
          if (parentEl) {
            const containerWidth = parentEl.clientWidth;
            const pctValue = parseInt(widthAttr, 10);
            if (!isNaN(pctValue) && containerWidth > 0) {
              const pxWidth = Math.round(containerWidth * (pctValue / 100));
              el.style.width = `${pxWidth}px`;
              if (node.attrs.aspectRatio) {
                el.style.height = `${Math.round(pxWidth / node.attrs.aspectRatio)}px`;
              }
            }
          }
          dom.style.visibility = '';
          dom.style.pointerEvents = '';
        });
      }

      dom.style.pointerEvents = 'none';
      dom.style.background =
        'light-dark(var(--mantine-color-gray-2), var(--mantine-color-dark-6))';

      const clearLoadingStyle = () => {
        dom.style.pointerEvents = '';
        dom.style.background = '';
      };
      el.addEventListener('load', clearLoadingStyle, { once: true });
      el.addEventListener('error', clearLoadingStyle, { once: true });
      if (el.complete) clearLoadingStyle();

      el.addEventListener('click', () => {
        if (!editor.isEditable) {
          window.dispatchEvent(
            new CustomEvent('open-image-lightbox', {
              detail: { src: el.src, alt: el.alt },
            }),
          );
        }
      });

      if (!editor.isEditable) {
        el.style.cursor = 'zoom-in';
      }

      return nodeView;
    };
  },
});

function applyAlignment(container: HTMLElement, align: string) {
  if (align === 'left') {
    container.style.justifyContent = 'flex-start';
  } else if (align === 'right') {
    container.style.justifyContent = 'flex-end';
  } else {
    container.style.justifyContent = 'center';
  }
}

