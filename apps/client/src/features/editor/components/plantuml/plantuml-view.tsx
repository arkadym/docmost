import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ActionIcon, Card, Image, Text } from "@mantine/core";
import { useMemo } from "react";
import { useDisclosure } from "@mantine/hooks";
import { getFileUrl } from "@/lib/config.ts";
import { IconEdit } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { PlantUmlEditModal, type PlantUmlSaveAttrs } from "./plantuml-edit-modal";

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

  const [opened, { open, close }] = useDisclosure(false);

  const handleOpen = () => {
    if (!editor.isEditable) return;
    open();
  };

  const handleSave = (attrs: PlantUmlSaveAttrs) => {
    updateAttributes(attrs);
  };

  return (
    <NodeViewWrapper data-drag-handle>
      <PlantUmlEditModal
        opened={opened}
        onClose={close}
        initialCode={code || getDefaultTemplate()}
        initialSrc={src ? getFileUrl(src) : null}
        attachmentId={attachmentId || null}
        pageId={(editor.storage as any)?.pageId ?? null}
        onSave={handleSave}
      />

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
