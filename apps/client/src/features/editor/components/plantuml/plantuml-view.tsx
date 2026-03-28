import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ActionIcon,
  Button,
  Card,
  Center,
  Group,
  Image,
  Loader,
  Modal,
  Text,
  Textarea,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { getFileUrl } from "@/lib/config.ts";
import { IconEdit } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import api from "@/lib/api-client.ts";

const PREVIEW_DEBOUNCE_MS = 2000;

function getDefaultTemplate(): string {
  return `@startuml\nAlice -> Bob: Hello\nBob -> Alice: Hi!\n@enduml`;
}

export default function PlantUmlView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, updateAttributes, editor, selected } = props;
  const { code, src, title, width, align, attachmentId } = node.attrs;

  const alignClass = useMemo(() => {
    if (align === "left") return "alignLeft";
    if (align === "right") return "alignRight";
    if (align === "center") return "alignCenter";
    return "alignCenter";
  }, [align]);

  const [plantUmlCode, setPlantUmlCode] = useState<string>(
    code || getDefaultTemplate(),
  );
  const [opened, { open, close }] = useDisclosure(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview state – separate from the save flow
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which code the current preview corresponds to
  const previewedCodeRef = useRef<string>("");

  const handleOpen = () => {
    if (!editor.isEditable) return;
    const initial = code || getDefaultTemplate();
    setPlantUmlCode(initial);
    setError(null);
    // Show the already-saved diagram as initial preview
    setPreviewSrc(src ? getFileUrl(src) : null);
    setPreviewError(null);
    // For a diagram that already has a saved src, mark the code as previewed
    // so the debounce guard doesn't block the first render when user edits.
    // For a NEW diagram (no src), leave previewedCodeRef empty so the first
    // render fires immediately on open.
    previewedCodeRef.current = src ? initial : "";
    open();
  };

  // Debounced preview render
  useEffect(() => {
    if (!opened) return;
    if (plantUmlCode === previewedCodeRef.current) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setIsPreviewing(true);
      setPreviewError(null);
      try {
        // @ts-ignore
        const pageId = editor.storage?.pageId;
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
      // @ts-ignore
      const pageId = editor.storage?.pageId;

      // If preview already rendered the current code, reuse its attachment
      let response;
      if (previewedCodeRef.current === plantUmlCode && previewSrc) {
        // Re-render to get full response with attachmentId etc.
        response = await api.post("/diagrams/plantuml/render", {
          code: plantUmlCode,
          pageId,
          attachmentId,
        });
      } else {
        response = await api.post("/diagrams/plantuml/render", {
          code: plantUmlCode,
          pageId,
          attachmentId,
        });
      }

      updateAttributes({
        code: plantUmlCode,
        src:
          response.data.src +
          `?t=${new Date(response.data.updatedAt).getTime()}`,
        title: response.data.title,
        size: response.data.size,
        attachmentId: response.data.attachmentId,
      });

      close();
    } catch (err: any) {
      setError(
        err.response?.data?.message || t("Failed to render PlantUML diagram"),
      );
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <NodeViewWrapper data-drag-handle>
      <Modal
        opened={opened}
        onClose={close}
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
              onChange={(e) => setPlantUmlCode(e.target.value)}
              placeholder={t("Enter PlantUML code...")}
              autosize
              minRows={20}
              styles={{ input: { fontFamily: "monospace", fontSize: "13px" } }}
            />
          </div>

          {/* Right: preview */}
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            {isPreviewing && (
              <Center style={{ position: "absolute", inset: 0, zIndex: 1 }}>
                <Loader size="sm" />
              </Center>
            )}
            {previewError && !isPreviewing && (
              <Text c="red" size="sm" p="sm">
                {previewError}
              </Text>
            )}
            {previewSrc && !previewError && (
              <img
                src={previewSrc}
                alt="PlantUML preview"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  opacity: isPreviewing ? 0.4 : 1,
                  transition: "opacity 0.2s",
                }}
              />
            )}
            {!previewSrc && !isPreviewing && !previewError && (
              <Center style={{ position: "absolute", inset: 0 }}>
                <Text c="dimmed" size="sm">
                  {t("Start typing to see preview")}
                </Text>
              </Center>
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
            <Button variant="default" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button onClick={handleSave} loading={isRendering}>
              {t("Save")}
            </Button>
          </Group>
        </div>
      </Modal>

      {src ? (
        <div
          className={clsx(
            selected && "ProseMirror-selectednode",
            alignClass,
          )}
          style={{ width }}
        >
          <Image
            radius="md"
            fit="contain"
            src={getFileUrl(src)}
            alt={title}
          />
        </div>
      ) : (
        <Card
          radius="md"
          onClick={(e) => e.detail === 2 && handleOpen()}
          p="xs"
          withBorder
          className={clsx(selected ? "ProseMirror-selectednode" : "")}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            cursor: editor.isEditable ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ActionIcon variant="transparent" color="gray">
              <IconEdit size={18} />
            </ActionIcon>
            <Text component="span" size="lg" c="dimmed">
              {t("Double-click to create PlantUML diagram")}
            </Text>
          </div>
        </Card>
      )}
    </NodeViewWrapper>
  );
}
