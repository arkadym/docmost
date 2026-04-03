import { atomWithWebStorage } from "@/lib/jotai-helper.ts";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const mobileSidebarAtom = atom<boolean>(false);

export const desktopSidebarAtom = atomWithWebStorage<boolean>(
  "showSidebar",
  true,
);

export const desktopAsideAtom = atom<boolean>(false);

export type AsideStateType = {
  tab: string;
  isAsideOpen: boolean;
};

export const asideStateAtom = atomWithStorage<AsideStateType>("asideState", {
  tab: "",
  isAsideOpen: false,
});

export const sidebarWidthAtom = atomWithWebStorage<number>('sidebarWidth', 300);