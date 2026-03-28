# FRD: Picture Viewer (Lightbox)

## Overview

Add a fullscreen zoom/pan lightbox for all image-like content in the editor and
read-only/share views. Users can click any rendered image or diagram to open it
in a lightbox and explore details that are not visible at document width.

## Affected Nodes

| TipTap node | View file | Current click behavior |
|---|---|---|
| `image` | `image-view.tsx` | none |
| `plantuml` | `plantuml-view.tsx` | double-click → edit modal |
| `drawio` | `drawio-view.tsx` | double-click → edit modal |
| `excalidraw` | `excalidraw-view.tsx` | double-click → edit modal |

## Trigger Convention

- **Single click** → open lightbox
- **Double click** → open editor (existing behavior for drawio/excalidraw/plantuml; no change)
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
  - Download button (same pattern as existing toolbar menus)
  - Close button (or press Escape via Modal)

The modal background is dark/semi-transparent. The image is centered and starts
fitted to the viewport (`initialScale` calculated to fit width or height,
whichever is smaller).

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

- Keyboard: `Escape` closes (Mantine Modal handles this)
- Mouse wheel: zoom in/out centered on cursor
- Click + drag: pan
- Touch: pinch to zoom, drag to pan
- Toolbar buttons: zoom +/−/reset, download
- The viewer is read-only — no editing from within lightbox
- Works identically in editor and read-only/share page contexts since the
  lightbox does not interact with TipTap at all

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

## Open Questions for Review

1. Should the lightbox toolbar show a **Download** button for all node types, or
   only for images (not diagrams)?  
2. Should double-click on a regular **image** also open something (it currently
   does nothing), or is single-click for lightbox sufficient?
3. Preferred initial zoom behavior: **fit-to-screen** (see the whole diagram) or
   **100% native size** (see full detail, may require scrolling)?
