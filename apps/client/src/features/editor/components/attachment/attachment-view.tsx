import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Group, Text, Paper, ActionIcon, Loader, Tooltip } from "@mantine/core";
import { getFileUrl } from "@/lib/config.ts";
import { IconDownload, IconFileTypePdf, IconPaperclip, IconTransform } from "@tabler/icons-react";
import { useHover } from "@mantine/hooks";
import { formatBytes } from "@/lib";
import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { notifications } from "@mantine/notifications";
import { uploadFile } from "@/features/page/services/page-service.ts";
import { convertXmindToPlantUmlAttrs } from "@/features/editor/components/plantuml/xmind-convert";

export default function AttachmentView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { editor, node, getPos, selected } = props;
  const { url, name, size, mime, attachmentId, placeholder } = node.attrs;
  const { hovered, ref } = useHover();
  const [isConverting, setIsConverting] = useState(false);

  const isXmind = typeof name === "string" && name.endsWith(".xmind");

  const handleConvert = async () => {
    setIsConverting(true);
    try {
      const pageId = (editor.storage as any)?.pageId ?? "";
      // File is already uploaded as attachment — use its id as xmindAttachmentId
      const xmindAttachmentId = node.attrs.attachmentId;

      // Fetch the file bytes from the stored attachment URL
      const response = await fetch(getFileUrl(url), { credentials: "include" });
      const blob = await response.blob();
      const file = new File([blob], name, { type: blob.type });

      const attrs = await convertXmindToPlantUmlAttrs(file, pageId, xmindAttachmentId);

      // Replace this attachment node with a plantuml node
      const pos = getPos();
      editor
        .chain()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .insertContentAt(pos, { type: "plantuml", attrs })
        .run();
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ?? t("Failed to convert to PlantUML"),
      });
    } finally {
      setIsConverting(false);
    }
  };

  const isPdf = mime === "application/pdf" || name?.toLowerCase().endsWith(".pdf");

  const handleEmbedAsPdf = useCallback(() => {
    const pos = getPos();
    if (pos === undefined || !url) return;

    const nodeSize = node.nodeSize;

    editor
      .chain()
      .insertContentAt(
        { from: pos, to: pos + nodeSize },
        {
          type: "pdf",
          attrs: {
            src: url,
            name,
            attachmentId,
            size,
          },
        },
      )
      .run();
  }, [editor, getPos, node, url, name, attachmentId]);

  return (
    <NodeViewWrapper>
      <Paper withBorder p="4px" ref={ref} data-drag-handle>
        <Group
          justify="space-between"
          gap="xl"
          style={{ cursor: "pointer" }}
          wrap="nowrap"
          h={25}
        >
          <Group wrap="nowrap" gap="sm" style={{ minWidth: 0, flex: 1 }}>
            {!url && placeholder ? (
              <Loader size={20} style={{ flexShrink: 0 }} />
            ) : (
              <IconPaperclip size={20} style={{ flexShrink: 0 }} />
            )}

            <Text component="span" size="md" truncate="end" style={{ minWidth: 0 }}>
              {!url && placeholder ? t("Uploading {{name}}", { name }) : name}
            </Text>

            <Text component="span" size="sm" c="dimmed" style={{ flexShrink: 0 }}>
              {formatBytes(size)}
            </Text>
          </Group>

          {url && (selected || hovered) && (
            <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
              {isXmind && editor.isEditable && (
                <Tooltip label={t("Convert to PlantUML")} position="top" withinPortal={false}>
                  <ActionIcon
                    variant="default"
                    loading={isConverting}
                    onClick={handleConvert}
                    aria-label={t("Convert to PlantUML")}
                  >
                    <IconTransform size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              {isPdf && editor.isEditable && (
                <Tooltip label={t("Embed as PDF")} position="top" withinPortal={false}>
                  <ActionIcon variant="default" aria-label={t("Embed as PDF")} onClick={handleEmbedAsPdf}>
                    <IconFileTypePdf size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <a href={getFileUrl(url)} target="_blank">
                <ActionIcon variant="default" aria-label="download file">
                  <IconDownload size={18} />
                </ActionIcon>
              </a>
            </Group>
          )}
        </Group>
      </Paper>
    </NodeViewWrapper>
  );
}
