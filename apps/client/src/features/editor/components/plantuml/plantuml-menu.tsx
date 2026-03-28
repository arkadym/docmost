import { BubbleMenu as BaseBubbleMenu } from "@tiptap/react/menus";
import { findParentNode, posToDOMRect, useEditorState } from "@tiptap/react";
import { useCallback, useState } from "react";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  EditorMenuProps,
  ShouldShowProps,
} from "@/features/editor/components/table/types/types.ts";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import clsx from "clsx";
import {
  IconDownload,
  IconEdit,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignRight,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getFileUrl } from "@/lib/config.ts";
import api from "@/lib/api-client.ts";
import classes from "../common/toolbar-menu.module.css";

export function PlantUmlMenu({ editor }: EditorMenuProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const [plantUmlCode, setPlantUmlCode] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null;
      const attrs = ctx.editor.getAttributes("plantuml");
      return {
        isAlignLeft: ctx.editor.isActive("plantuml", { align: "left" }),
        isAlignCenter: ctx.editor.isActive("plantuml", { align: "center" }),
        isAlignRight: ctx.editor.isActive("plantuml", { align: "right" }),
        src: attrs?.src || null,
        code: attrs?.code || "",
        attachmentId: attrs?.attachmentId || null,
      };
    },
  });

  const shouldShow = useCallback(
    ({ state }: ShouldShowProps) => {
      if (!state) return false;
      return (
        editor.isActive("plantuml") &&
        !!editor.getAttributes("plantuml")?.src &&
        editor.isEditable
      );
    },
    [editor],
  );

  const getReferencedVirtualElement = useCallback(() => {
    if (!editor) return;
    const { selection } = editor.state;
    const predicate = (node: PMNode) => node.type.name === "plantuml";
    const parent = findParentNode(predicate)(selection);

    if (parent) {
      const dom = editor.view.nodeDOM(parent?.pos) as HTMLElement;
      const domRect = dom.getBoundingClientRect();
      return {
        getBoundingClientRect: () => domRect,
        getClientRects: () => [domRect],
      };
    }

    const domRect = posToDOMRect(editor.view, selection.from, selection.to);
    return {
      getBoundingClientRect: () => domRect,
      getClientRects: () => [domRect],
    };
  }, [editor]);

  const handleOpen = useCallback(() => {
    setPlantUmlCode(editorState?.code || "");
    setError(null);
    open();
  }, [editorState?.code, open]);

  const handleSave = async () => {
    setIsRendering(true);
    setError(null);
    try {
      // @ts-ignore
      const pageId = editor.storage?.pageId;
      const response = await api.post("/diagrams/plantuml/render", {
        code: plantUmlCode,
        pageId,
        attachmentId: editorState?.attachmentId,
      });
      editor.commands.updateAttributes("plantuml", {
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

  const alignLeft = useCallback(() => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setPlantUmlAlign("left")
      .run();
  }, [editor]);

  const alignCenter = useCallback(() => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setPlantUmlAlign("center")
      .run();
  }, [editor]);

  const alignRight = useCallback(() => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setPlantUmlAlign("right")
      .run();
  }, [editor]);

  const handleDownload = useCallback(() => {
    if (!editorState?.src) return;
    const url = getFileUrl(editorState.src);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.plantuml.svg";
    a.click();
  }, [editorState?.src]);

  const handleDelete = useCallback(() => {
    editor.commands.deleteSelection();
  }, [editor]);

  return (
    <>
      <BaseBubbleMenu
        editor={editor}
        pluginKey="plantuml-menu"
        updateDelay={0}
        getReferencedVirtualElement={getReferencedVirtualElement}
        options={{ placement: "top", offset: 8, flip: false }}
        shouldShow={shouldShow}
      >
        <div className={classes.toolbar}>
          <Tooltip position="top" label={t("Align left")} withinPortal={false}>
            <ActionIcon
              onClick={alignLeft}
              size="lg"
              variant="subtle"
              className={clsx({ [classes.active]: editorState?.isAlignLeft })}
            >
              <IconLayoutAlignLeft size={18} />
            </ActionIcon>
          </Tooltip>

          <Tooltip
            position="top"
            label={t("Align center")}
            withinPortal={false}
          >
            <ActionIcon
              onClick={alignCenter}
              size="lg"
              variant="subtle"
              className={clsx({ [classes.active]: editorState?.isAlignCenter })}
            >
              <IconLayoutAlignCenter size={18} />
            </ActionIcon>
          </Tooltip>

          <Tooltip position="top" label={t("Align right")} withinPortal={false}>
            <ActionIcon
              onClick={alignRight}
              size="lg"
              variant="subtle"
              className={clsx({ [classes.active]: editorState?.isAlignRight })}
            >
              <IconLayoutAlignRight size={18} />
            </ActionIcon>
          </Tooltip>

          <div className={classes.divider} />

          <Tooltip position="top" label={t("Edit")} withinPortal={false}>
            <ActionIcon onClick={handleOpen} size="lg" variant="subtle">
              <IconEdit size={18} />
            </ActionIcon>
          </Tooltip>

          <Tooltip position="top" label={t("Download")} withinPortal={false}>
            <ActionIcon onClick={handleDownload} size="lg" variant="subtle">
              <IconDownload size={18} />
            </ActionIcon>
          </Tooltip>

          <Tooltip position="top" label={t("Delete")} withinPortal={false}>
            <ActionIcon onClick={handleDelete} size="lg" variant="subtle">
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        </div>
      </BaseBubbleMenu>

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
    </>
  );
}

export default PlantUmlMenu;
