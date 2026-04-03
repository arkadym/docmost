import { ActionIcon, Box, Group, ScrollArea, Text } from "@mantine/core";
import CommentListWithTabs from "@/features/comment/components/comment-list-with-tabs.tsx";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import React, { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TableOfContents } from "@/features/editor/components/table-of-contents/table-of-contents.tsx";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { IconX } from "@tabler/icons-react";

export default function Aside() {
  const [asideState, setAsideState] = useAtom(asideStateAtom);
  const { tab } = asideState;
  const { t } = useTranslation();
  const pageEditor = useAtomValue(pageEditorAtom);

  let title: string;
  let component: ReactNode;

  switch (tab) {
    case "comments":
      component = <CommentListWithTabs />;
      title = "Comments";
      break;
    case "toc":
      component = <TableOfContents editor={pageEditor} />;
      title = "Table of contents";
      break;
    default:
      component = null;
      title = null;
  }

  return (
    <Box p="md" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {component && (
        <>
          <Group justify="space-between" mb="md">
            <Text fw={500}>{t(title)}</Text>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setAsideState({ tab, isAsideOpen: false })}
            >
              <IconX size={16} />
            </ActionIcon>
          </Group>

          {tab === "comments" ? (
            <CommentListWithTabs />
          ) : (
            <ScrollArea
              style={{ height: "85vh" }}
              scrollbarSize={5}
              type="scroll"
            >
              <div style={{ paddingBottom: "200px" }}>{component}</div>
            </ScrollArea>
          )}
        </>
      )}
    </Box>
  );
}
