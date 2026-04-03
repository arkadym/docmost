export type SpaceTreeNode = {
  id: string;
  slugId: string;
  name: string;
  icon?: string;
  position: string;
  spaceId: string;
  parentPageId: string;
  hasChildren: boolean;
  canEdit?: boolean;
  createdAt: string;
  updatedAt: string;
  children: SpaceTreeNode[];
};
