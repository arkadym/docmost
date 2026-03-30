import { BubbleMenu as BaseBubbleMenu } from "@tiptap/react/menus";
import { findParentNode, posToDOMRect, useEditorState } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  EditorMenuProps,
  ShouldShowProps,
} from "@/features/editor/components/table/types/types.ts";
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

const PREVIEW_DEBOUNCE_MS = 2000;

export function PlantUmlMenu({ editor }: EditorMenuProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const [plantUmlCode, setPlantUmlCode] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-import state
  const [isReimporting, setIsReimporting] = useState(false);
  const [reimportWarningOpened, { open: openReimportWarning, close: closeReimportWarning }] =
    useDisclosure(false);
  const reimportInputRef = useRef<HTMLInputElement | null>(null);

  // Preview state
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewedCodeRef = useRef<string>("");

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

  const handleOpen = useCallback(() => {
    const initialCode = editorState?.code || "";
    setPlantUmlCode(initialCode);
    setError(null);
    setPreviewSrc(editorState?.src ? getFileUrl(editorState.src) : null);
    setPreviewError(null);
    previewedCodeRef.current = initialCode;
    open();
  }, [editorState?.code, editorState?.src, open]);

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
          attachmentId: editorState?.attachmentId,
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
      let response;
      if (previewedCodeRef.current === plantUmlCode && previewSrc) {
        response = await api.post("/diagrams/plantuml/render", {
          code: plantUmlCode,
          pageId,
          attachmentId: editorState?.attachmentId,
        });
      } else {
        response = await api.post("/diagrams/plantuml/render", {
          code: plantUmlCode,
          pageId,
          attachmentId: editorState?.attachmentId,
        });
      }
      editor.commands.updateAttributes("plantuml", {
        code: plantUmlCode,
        src:
          response.data.src +
          `?t=${new Date(response.data.updatedAt).getTime()}`,
        title: response.data.title,
        size: response.data.size,
        attachmentId: response.data.attachmentId,
        // mark as modified if this is an XMind-backed diagram
        ...(editorState?.xmindAttachmentId ? { xmindModified: true } : {}),
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
