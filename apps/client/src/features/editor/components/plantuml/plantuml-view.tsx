import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Image,
  Modal,
  Text,
  Textarea,
} from "@mantine/core";
import { useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { getFileUrl } from "@/lib/config.ts";
import { IconEdit } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import api from "@/lib/api-client.ts";

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

  const handleOpen = () => {
    if (!editor.isEditable) return;
    setPlantUmlCode(code || getDefaultTemplate());
    setError(null);
    open();
  };

  const handleSave = async () => {
    setIsRendering(true);
    setError(null);

    try {
      // @ts-ignore
      const pageId = editor.storage?.pageId;

      const response = await api.post("/diagrams/plantuml/render", {
        code: plantUmlCode,
        pageId,
        attachmentId,
      });

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
        size="xl"
        title={t("Edit PlantUML diagram")}
      >
        <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
          <Textarea
            value={plantUmlCode}
            onChange={(e) => setPlantUmlCode(e.target.value)}
            placeholder={t("Enter PlantUML code...")}
            autosize
            minRows={10}
            styles={{ input: { fontFamily: "monospace", fontSize: "14px" } }}
          />
        </div>

        {error && (
          <Text c="red" size="sm" mt="xs">
            {error}
          </Text>
        )}

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button onClick={handleSave} loading={isRendering}>
            {t("Save")}
          </Button>
        </Group>
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
