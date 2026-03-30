import { BubbleMenu as BaseBubbleMenu } from "@tiptap/react/menus";
import { findParentNode, posToDOMRect, useEditorState } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
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
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import clsx from "clsx";
import {
  IconDownload,
  IconEdit,
  IconFileDownload,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignRight,
  IconRefresh,
  IconTrash,
  IconZoomIn,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getFileUrl } from "@/lib/config.ts";
import api from "@/lib/api-client.ts";
import { notifications } from "@mantine/notifications";
import { uploadFile } from "@/features/page/services/page-service.ts";
import { convertXmindToPlantUmlAttrs } from "./xmind-convert";
import classes from "../common/toolbar-menu.module.css";
import { PlantUmlEditModal, type PlantUmlSaveAttrs } from "./plantuml-edit-modal";

export function PlantUmlMenu({ editor }: EditorMenuProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);

  // Re-import state
  const [isReimporting, setIsReimporting] = useState(false);
  const [reimportWarningOpened, { open: openReimportWarning, close: closeReimportWarning }] =
    useDisclosure(false);
  const reimportInputRef = useRef<HTMLInputElement | null>(null);

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
        xmindAttachmentId: attrs?.xmindAttachmentId || null,
        xmindModified: attrs?.xmindModified ?? false,
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

  const handleSaveAttrs = useCallback((attrs: PlantUmlSaveAttrs) => {
    editor.commands.updateAttributes("plantuml", {
      ...attrs,
      ...(editorState?.xmindAttachmentId ? { xmindModified: true } : {}),
    });
  }, [editor, editorState?.xmindAttachmentId]);

  const handleOpen = useCallback(() => {
    open();
  }, [open]);

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

  const handleView = useCallback(() => {
    if (!editorState?.src) return;
    window.dispatchEvent(
      new CustomEvent("open-image-lightbox", {
        detail: { src: getFileUrl(editorState.src), alt: "PlantUML" },
      }),
    );
  }, [editorState?.src]);

  const handleDownload = useCallback(() => {
    if (!editorState?.src) return;
    const url = getFileUrl(editorState.src);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.plantuml.svg";
    a.click();
  }, [editorState?.src]);

  const handleDownloadXmind = useCallback(async () => {
    if (!editorState?.xmindAttachmentId) return;
    try {
      const res = await api.post("/files/info", { attachmentId: editorState.xmindAttachmentId });
      const { fileName } = res.data;
      const url = getFileUrl(`/api/files/${editorState.xmindAttachmentId}/${fileName}`);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    } catch {
      // silently ignore — attachment may have been deleted
    }
  }, [editorState?.xmindAttachmentId]);

  const handleDelete = useCallback(() => {
    editor.commands.deleteSelection();
  }, [editor]);

  const handleReimportClick = useCallback(() => {
    if (editorState?.xmindModified) {
      openReimportWarning();
    } else {
      reimportInputRef.current?.click();
    }
  }, [editorState?.xmindModified, openReimportWarning]);

  const handleReimportConfirm = useCallback(() => {
    closeReimportWarning();
    reimportInputRef.current?.click();
  }, [closeReimportWarning]);

  const handleReimportFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      setIsReimporting(true);
      try {
        const pageId = (editor.storage as any)?.pageId ?? "";
        const xmindAttachment = await uploadFile(file, pageId);
        const currentAttachmentId = editor.getAttributes("plantuml").attachmentId;
        const attrs = await convertXmindToPlantUmlAttrs(
          file,
          pageId,
          xmindAttachment.id,
          currentAttachmentId,
        );
        editor.commands.updateAttributes("plantuml", attrs);
      } catch (err: any) {
        notifications.show({
          color: "red",
          message: err?.response?.data?.message ?? t("Failed to re-import XMind"),
        });
      } finally {
        setIsReimporting(false);
      }
    },
    [editor, t],
  );

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

          <Tooltip position="top" label={t("View")} withinPortal={false}>
            <ActionIcon onClick={handleView} size="lg" variant="subtle">
              <IconZoomIn size={18} />
            </ActionIcon>
          </Tooltip>

          <Tooltip position="top" label={t("Edit")} withinPortal={false}>
            <ActionIcon onClick={handleOpen} size="lg" variant="subtle">
              <IconEdit size={18} />
            </ActionIcon>
          </Tooltip>

          <div className={classes.divider} />

          {editorState?.xmindAttachmentId && (
            <>
              <Tooltip position="top" label={t("Re-import XMind")} withinPortal={false}>
                <ActionIcon
                  onClick={handleReimportClick}
                  size="lg"
                  variant="subtle"
                  loading={isReimporting}
                >
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>

              <Tooltip position="top" label={t("Download XMind")} withinPortal={false}>
                <ActionIcon onClick={handleDownloadXmind} size="lg" variant="subtle">
                  <IconFileDownload size={18} />
                </ActionIcon>
              </Tooltip>
            </>
          )}

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

      <PlantUmlEditModal
        opened={opened}
        onClose={close}
        initialCode={editorState?.code || ""}
        initialSrc={editorState?.src ? getFileUrl(editorState.src) : null}
        attachmentId={editorState?.attachmentId ?? null}
        pageId={(editor.storage as any)?.pageId ?? null}
        onSave={handleSaveAttrs}
      />

      {/* Hidden file input for re-import */}
      <input
        ref={reimportInputRef}
        type="file"
        accept=".xmind"
        style={{ display: "none" }}
        onChange={handleReimportFileChange}
      />

      {/* Warning: manual edits will be overwritten */}
      <Modal
        opened={reimportWarningOpened}
        onClose={closeReimportWarning}
        title={t("You have manually edited this diagram.")}
        size="sm"
      >
        <Text size="sm" mb="md">
          {t(
            "Re-importing will overwrite your changes with the content from the new XMind file. The previous version is saved in document history and can be restored.",
          )}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeReimportWarning}>
            {t("Cancel")}
          </Button>
          <Button color="red" onClick={handleReimportConfirm}>
            {t("Re-import anyway")}
          </Button>
        </Group>
      </Modal>
    </>
  );
}

export default PlantUmlMenu;
