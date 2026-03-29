import { useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { Editor } from "@tiptap/core";
import api from "@/lib/api-client.ts";
import { uploadFile } from "@/features/page/services/page-service.ts";
import { formatBytes } from "@/lib";

interface XmindImportModalProps {
  file: File | null;
  pageId: string;
  editor: Editor | null;
  opened: boolean;
  onClose: () => void;
  /** When set, re-import updates an existing plantuml node instead of inserting */
  existingAttachmentId?: string | null;
}

export function XmindImportModal({
  file,
  pageId,
  editor,
  opened,
  onClose,
  existingAttachmentId,
}: XmindImportModalProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const isReimport = existingAttachmentId !== undefined;

  const handleImport = async () => {
    if (!file || !editor) return;
    setIsLoading(true);
    try {
      // 1. Convert XMind → PlantUML code
      const convertForm = new FormData();
      convertForm.append("file", file);
      const convertRes = await api.post<{ plantumlCode: string }>(
        "/diagrams/xmind/convert",
        convertForm,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const plantumlCode = convertRes.data.plantumlCode;

      // 2. Upload .xmind file as attachment (for future re-import)
      const xmindAttachment = await uploadFile(file, pageId);
      const xmindAttachmentId = xmindAttachment.id;

      // 3. Render PlantUML → SVG
      const renderRes = await api.post("/diagrams/plantuml/render", {
        code: plantumlCode,
        pageId,
        attachmentId: existingAttachmentId ?? undefined,
      });
      const { src, attachmentId, title, size, updatedAt } = renderRes.data;
      const srcWithTs = src + `?t=${new Date(updatedAt).getTime()}`;

      const attrs = {
        code: plantumlCode,
        src: srcWithTs,
        title,
        size,
        attachmentId,
        xmindAttachmentId,
        xmindModified: false,
      };

      if (isReimport) {
        editor.commands.updateAttributes("plantuml", attrs);
      } else {
        editor.commands.setPlantUml(attrs);
      }

      onClose();
    } catch (err: any) {
      notifications.show({
        color: "red",
        message:
          err?.response?.data?.message ?? t("Failed to import XMind file"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isReimport ? t("Re-import XMind file") : t("Import XMind file")}
      size="sm"
    >
      <Stack gap="md">
        {file && (
          <Stack gap={4}>
            <Text fw={500} size="sm">
              {file.name}
            </Text>
            <Text c="dimmed" size="xs">
              {formatBytes(file.size)}
            </Text>
          </Stack>
        )}

        {isReimport && (
          <Text size="sm" c="dimmed">
            {t(
              "The mind map diagram will be regenerated from the new XMind file.",
            )}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={isLoading}>
            {t("Cancel")}
          </Button>
          <Button onClick={handleImport} loading={isLoading}>
            {t("Import as mind map")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
