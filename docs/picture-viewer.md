# FRD: Picture Viewer (Lightbox)

## Overview

Add a fullscreen zoom/pan lightbox for all image-like content in the editor and
read-only/share views. Users can click any rendered image or diagram to open it
in a lightbox and explore details that are not visible at document width.

## Diagram Type Badges

All diagram nodes (`plantuml`, `drawio`, `excalidraw`) display a small 16×16 logo
badge in the top-right corner of the rendered image to indicate the diagram type:

| Node | Badge file |
|---|---|
| `plantuml` (plain) | `/icons/plantuml-logo.svg` |
| `plantuml` (XMind-backed) | `/icons/xmind-logo.png` |
| `drawio` | `/icons/drawio-logo.svg` |
| `excalidraw` | `/icons/excalidraw-logo.png` |

Badges are implemented as absolutely-positioned `<img>` elements (`opacity: 0.75`,
`pointer-events: none`) appended to the node view container in the native DOM
node view code (`plantuml.ts`, `drawio.ts`, `excalidraw.ts`). They do not
interfere with the lightbox click or any other interaction.

Logo files are static assets placed in `apps/client/public/icons/` and served
verbatim by Vite / the production server at `/icons/<filename>`.



| TipTap node | View file | Current click behavior |
|---|---|---|
| `image` | `image-view.tsx` | none |
| `plantuml` | `plantuml-view.tsx` | double-click → edit modal |
| `drawio` | `drawio-view.tsx` | double-click → edit modal |
| `excalidraw` | `excalidraw-view.tsx` | double-click → edit modal |

## Trigger Convention

- **Single click** → open lightbox (all node types)
- **Double click** → open editor for drawio/excalidraw/plantuml (existing behavior, no change)
- Regular **images** have no double-click action — single click is the only interaction
- In **read-only / share** views there is no editor, so single click is the only
  action — same lightbox opens

## New Component: `ImageLightbox`

**Location**: `apps/client/src/features/editor/components/common/image-lightbox.tsx`

A shared, self-contained component accepting:

```ts
interface ImageLightboxProps {
  src: string;       // full resolved URL
  alt?: string;      // optional caption / alt text
  opened: boolean;
  onClose: () => void;
}
```

Internally it uses:
- Mantine `Modal` with `fullScreen` prop — covers the whole viewport
- `react-zoom-pan-pinch` (`TransformWrapper` + `TransformComponent`) for
  zoom/pan/pinch
- A small toolbar overlay (top-right) with:
  - Zoom in (`+`)
  - Zoom out (`−`)
  - Reset zoom (fit to screen)
  - Download button — all node types; images download in their native format,
    diagrams (PlantUML, Draw.io, Excalidraw) download the stored SVG attachment
  - Close button (or press Escape via Modal)

The modal background is dark/semi-transparent. The image is positioned as follows:
- If the **native image size fits within the viewport** → display at 100% (no scaling)
- If the **image is larger than the viewport** in either dimension → scale down to fit
  entirely within the viewport (letterboxed), using the larger dimension as the
  constraining axis

This means small diagrams appear crisp and unscaled, while large/complex diagrams
are scaled down to be fully visible on open. The user can then zoom in freely.

## Library

**`react-zoom-pan-pinch`** — already a common choice in the React ecosystem,
~15 KB gzipped. Handles mouse wheel zoom, click-drag pan, touch pinch.

No backend changes. No TipTap extension changes. No new server routes.

## Integration Points

### `image-view.tsx`
- Add `const [lightboxOpen, setLightboxOpen] = useState(false)`
- Add `onClick={() => setLightboxOpen(true)}` on the wrapper `<div>`
- Render `<ImageLightbox src={getFileUrl(src)} opened={lightboxOpen} onClose={() => setLightboxOpen(false)} />`
- Only show lightbox when `src` is set (skip when placeholder/loading)

### `plantuml-view.tsx`
- Same pattern on the `<div>` wrapper around `<Image>` (only when `src` is set)
- Single click = lightbox; existing double-click-to-edit on the Card placeholder
  stays unchanged

### `drawio-view.tsx`
- Add lightbox on single click
- Change existing `e.detail === 2` double-click to open editor (already is
  double-click, no change needed)

### `excalidraw-view.tsx`
- Same as drawio

## UX Details

- **Keyboard**: `Escape` closes (Mantine Modal handles this)
- **Mouse wheel**: zoom in/out centered on cursor
- **Click + drag**: pan
- **Touch**: pinch to zoom, drag to pan
- **Toolbar buttons**: zoom +/−/reset, download
- **Read-only**: the viewer is read-only — no editing from within lightbox
- **Contexts**: works identically in editor and read-only/share page contexts since the lightbox does not interact with TipTap at all
- **Download**: available for all node types; images download in their native format, diagrams (PlantUML, Draw.io, Excalidraw) download the stored SVG attachment
- **Click on regular images**: single click opens the lightbox; no double-click action
- **Initial zoom**: if the image fits within the viewport at 100%, it is displayed at 100%; if it exceeds the viewport in either dimension, it is scaled down to fit entirely, constrained by the larger dimension — the user can then zoom in freely

## Out of Scope

- Slideshow / gallery navigation between images on the page
- Thumbnail strip
- Annotations or markup inside the lightbox

## Files to Create / Modify

| Action | File |
|---|---|
| **Create** | `apps/client/src/features/editor/components/common/image-lightbox.tsx` |
| **Modify** | `apps/client/src/features/editor/components/image/image-view.tsx` |
| **Modify** | `apps/client/src/features/editor/components/plantuml/plantuml-view.tsx` |
| **Modify** | `apps/client/src/features/editor/components/drawio/drawio-view.tsx` |
| **Modify** | `apps/client/src/features/editor/components/excalidraw/excalidraw-view.tsx` |
| **Modify** | `apps/client/package.json` (add `react-zoom-pan-pinch`) |

