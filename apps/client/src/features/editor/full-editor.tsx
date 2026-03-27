import classes from "@/features/editor/styles/editor.module.css";
import React, { useEffect, useState } from "react";
import { TitleEditor } from "@/features/editor/title-editor";
import PageEditor from "@/features/editor/page-editor";
import { Container } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { IconLayoutList } from "@tabler/icons-react";

const MemoizedTitleEditor = React.memo(TitleEditor);
const MemoizedPageEditor = React.memo(PageEditor);

/** Shows an "Add properties" prompt below the title while no pageProperties node exists. */
function AddPropertiesButton({ editable }: { editable: boolean }) {
  const editor = useAtomValue(pageEditorAtom);
  const [hasProperties, setHasProperties] = useState(false);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const first = editor.state.doc.firstChild;
      setHasProperties(first?.type.name === "pageProperties");
    };

    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  if (!editable || hasProperties || !editor) return null;

  return (
    // Padding matches .ProseMirror padding-left: 3rem (1rem on small screens)
    <div style={{ paddingLeft: "clamp(1rem, 3rem, 3rem)", paddingRight: "clamp(1rem, 3rem, 3rem)" }}>
      <button
        onClick={() =>
          editor.commands.insertPageProperties([{ key: "", value: "" }])
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          color: "var(--mantine-color-gray-5)",
          padding: "2px 4px",
          marginBottom: 4,
          borderRadius: 4,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--mantine-color-gray-7)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--mantine-color-gray-5)")
        }
      >
        <IconLayoutList size={14} />
        Add properties
      </button>
    </div>
  );
}

export interface FullEditorProps {
  pageId: string;
  slugId: string;
  title: string;
  content: string;
  spaceSlug: string;
  editable: boolean;
}

export function FullEditor({
  pageId,
  title,
  slugId,
  content,
  spaceSlug,
  editable,
}: FullEditorProps) {
  const [user] = useAtom(userAtom);
  const fullPageWidth = user.settings?.preferences?.fullPageWidth;

  return (
    <Container
      fluid={fullPageWidth}
      size={!fullPageWidth && 900}
      className={classes.editor}
    >
      <MemoizedTitleEditor
        pageId={pageId}
        slugId={slugId}
        title={title}
        spaceSlug={spaceSlug}
        editable={editable}
      />
      <AddPropertiesButton editable={editable} />
      <MemoizedPageEditor
        pageId={pageId}
        editable={editable}
        content={content}
      />
    </Container>
  );
}
