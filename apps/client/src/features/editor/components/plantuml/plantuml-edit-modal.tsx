import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { IconArrowsMaximize, IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getFileUrl } from "@/lib/config.ts";
import api from "@/lib/api-client.ts";

const PREVIEW_DEBOUNCE_MS = 2000;

export interface PlantUmlSaveAttrs {
  code: string;
  src: string;
  title: string;
  size: number;
  attachmentId: string;
}

interface PlantUmlEditModalProps {
  opened: boolean;
  onClose: () => void;
  initialCode: string;
  initialSrc: string | null;
  attachmentId: string | null;
  pageId: string | null;
  onSave: (attrs: PlantUmlSaveAttrs) => void;
}

export function PlantUmlEditModal({
  opened,
  onClose,
  initialCode,
  initialSrc,
  attachmentId,
  pageId,
  onSave,
}: PlantUmlEditModalProps) {
  const { t } = useTranslation();
  const [plantUmlCode, setPlantUmlCode] = useState(initialCode);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(initialSrc);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewedCodeRef = useRef<string>(initialSrc ? initialCode : "");
  const hasUserEdited = useRef(false);
  // Starts true on every open — disabled until Yjs stops delivering updates.
  // This prevents the user from ever seeing or editing truncated code caused
  // by opening the modal before the collaboration server finishes syncing.
  const [isCodeSettling, setIsCodeSettling] = useState(false);

  const scheduleSettle = useCallback((delay = 500) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setIsCodeSettling(false), delay);
  }, []);

  // Reset and lock on every open. scheduleSettle(0) unlocks on next tick if
  // Yjs is already synced; if updates arrive they reset the timer to 500 ms.
  useEffect(() => {
    if (opened) {
      hasUserEdited.current = false;
      setIsCodeSettling(true);
      setPlantUmlCode(initialCode);
      setError(null);
      setPreviewSrc(initialSrc);
      setPreviewError(null);
      previewedCodeRef.current = initialSrc ? initialCode : "";
      scheduleSettle(0);
    } else {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    }
  }, [opened]);

  // Accept Yjs updates while settling. Each update resets the timer to 500 ms
  // so we stay locked until Yjs goes quiet.
  useEffect(() => {
    if (opened && !hasUserEdited.current) {
      setPlantUmlCode(initialCode);
      setPreviewSrc(initialSrc);
      previewedCodeRef.current = initialSrc ? initialCode : "";
      scheduleSettle(500);
    }
  }, [initialCode]);

  // Debounced preview render
  useEffect(() => {
    if (!opened) return;
    if (plantUmlCode === previewedCodeRef.current) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setIsPreviewing(true);
      setPreviewError(null);
      try {
        const response = await api.post("/diagrams/plantuml/render", {
          code: plantUmlCode,
          pageId,
          attachmentId,
        });
        setPreviewSrc(
          getFileUrl(response.data.src + `?t=${new Date(response.data.updatedAt).getTime()}`),
        );
        previewedCodeRef.current = plantUmlCode;
      } catch (err: any) {
        setPreviewError(
          err.response?.data?.message || t("Failed to render PlantUML diagram"),
        );
      } finally {
        setIsPreviewing(false);
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [plantUmlCode, opened]);

  const handleSave = async () => {
    setIsRendering(true);
    setError(null);
    try {
      const response = await api.post("/diagrams/plantuml/render", {
        code: plantUmlCode,
        pageId,
        attachmentId,
      });
      onSave({
        code: plantUmlCode,
        src: response.data.src + `?t=${new Date(response.data.updatedAt).getTime()}`,
        title: response.data.title,
        size: response.data.size,
        attachmentId: response.data.attachmentId,
      });
      onClose();
    } catch (err: any) {
      setError(
        err.response?.data?.message || t("Failed to render PlantUML diagram"),
      );
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="90vw"
      styles={{
        content: { maxWidth: 1400 },
        body: {
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 163px)",
          overflow: "hidden",
          padding: "12px 16px",
        },
      }}
      title={t("Edit PlantUML diagram")}
    >
      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0, alignItems: "stretch" }}>
        {/* Left: code editor */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          <Textarea
            value={plantUmlCode}
            disabled={isCodeSettling}
            onChange={(e) => {
              hasUserEdited.current = true;
              setPlantUmlCode(e.target.value);
            }}
            placeholder={isCodeSettling ? t("Syncing document…") : t("Enter PlantUML code...")}
            autosize
            minRows={20}
            styles={{ input: { fontFamily: "monospace", fontSize: "13px" } }}
          />
        </div>

        {/* Right: preview */}
        <div
          style={{ flex: 1, minWidth: 0, position: "relative", border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, overflow: "hidden" }}
        >
          {isPreviewing && (
            <Center style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
              <Loader size="sm" />
            </Center>
          )}
          {previewError && !isPreviewing && (
            <Center style={{ position: "absolute", inset: 0 }}>
              <Text c="red" size="sm" p="sm">
                {previewError}
              </Text>
            </Center>
          )}
          {!previewSrc && !isPreviewing && !previewError && (
            <Center style={{ position: "absolute", inset: 0 }}>
              <Text c="dimmed" size="sm">
                {t("Start typing to see preview")}
              </Text>
            </Center>
          )}
          {previewSrc && !previewError && (
            <div style={{ position: "absolute", inset: 0 }}>
              <TransformWrapper key={previewSrc} limitToBounds={false} minScale={0.05} maxScale={20} centerOnInit>
                {({ zoomIn, zoomOut, centerView }) => (
                  <>
                    <Group style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }} gap={4}>
                      <Tooltip label={t("Zoom in")} withinPortal>
                        <ActionIcon variant="default" size="sm" onClick={() => zoomIn()}>
                          <IconZoomIn size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("Zoom out")} withinPortal>
                        <ActionIcon variant="default" size="sm" onClick={() => zoomOut()}>
                          <IconZoomOut size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("Reset zoom")} withinPortal>
                        <ActionIcon variant="default" size="sm" onClick={() => centerView(1)}>
                          <IconArrowsMaximize size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                    <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
                      <img
                        src={previewSrc}
                        alt="PlantUML preview"
                        style={{
                          display: "block",
                          maxWidth: "100%",
                          opacity: isPreviewing ? 0.4 : 1,
                          transition: "opacity 0.2s",
                          userSelect: "none",
                        }}
                      />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            </div>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        {error && (
          <Text c="red" size="sm" mt="xs">
            {error}
          </Text>
        )}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button onClick={handleSave} loading={isRendering} disabled={isCodeSettling}>
            {t("Save")}
          </Button>
        </Group>
      </div>
    </Modal>
  );
}
