import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Group, Modal, Tooltip } from '@mantine/core';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  IconArrowsMaximize,
  IconDownload,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';

interface LightboxState {
  src: string;
  alt: string;
}

export default function ImageLightbox() {
  const [state, setState] = useState<LightboxState | null>(null);
  const fittedScaleRef = useRef(1);
  const fittedPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handler = (e: Event) => {
      const { src, alt } = (e as CustomEvent<LightboxState>).detail;
      setState({ src, alt: alt || '' });
    };
    window.addEventListener('open-image-lightbox', handler);
    return () => window.removeEventListener('open-image-lightbox', handler);
  }, []);

  return (
    <Modal
      opened={!!state}
      onClose={() => setState(null)}
      fullScreen
      withCloseButton={false}
      padding={0}
      styles={{
        content: { background: 'rgba(0, 0, 0, 0.92)' },
        body: { height: '100%', padding: 0 },
      }}
    >
      {state && (
        <TransformWrapper
          key={state.src}
          limitToBounds={false}
          minScale={0.05}
          maxScale={20}
          centerOnInit
        >
          {({ zoomIn, zoomOut, setTransform }) => (
            <>
              <Group
                style={{ position: 'fixed', top: 16, right: 16, zIndex: 300 }}
                gap="xs"
              >
                <Tooltip label="Zoom in">
                  <ActionIcon variant="default" size="lg" onClick={() => zoomIn()}>
                    <IconZoomIn size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Zoom out">
                  <ActionIcon variant="default" size="lg" onClick={() => zoomOut()}>
                    <IconZoomOut size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Fit to screen">
                  <ActionIcon
                    variant="default"
                    size="lg"
                    onClick={() => setTransform(fittedPosRef.current.x, fittedPosRef.current.y, fittedScaleRef.current, 300)}
                  >
                    <IconArrowsMaximize size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Download">
                  <ActionIcon
                    component="a"
                    href={state.src}
                    download
                    variant="default"
                    size="lg"
                  >
                    <IconDownload size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Close">
                  <ActionIcon variant="default" size="lg" onClick={() => setState(null)}>
                    <IconX size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <TransformComponent
                wrapperStyle={{ width: '100vw', height: '100vh' }}
              >
                <img
                  src={state.src}
                  alt={state.alt}
                  style={{ display: 'block', userSelect: 'none' }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    const vw = window.innerWidth;
                    const vh = window.innerHeight;
                    const scale = Math.min(
                      1,
                      Math.min(vw * 0.9 / img.naturalWidth, vh * 0.9 / img.naturalHeight),
                    );
                    fittedScaleRef.current = scale;
                    const posX = (vw - img.naturalWidth * scale) / 2;
                    const posY = (vh - img.naturalHeight * scale) / 2;
                    fittedPosRef.current = { x: posX, y: posY };
                    setTransform(posX, posY, scale, 0);
                  }}
                />
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      )}
    </Modal>
  );
}
