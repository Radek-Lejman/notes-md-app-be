export interface BaseTreeIdentity {
  id: string;
  parentId: string | null;
}

export interface TreeNode<TData> extends BaseTreeIdentity {
  children: Array<TreeNode<TData>>;
  data: Omit<TData, 'id'>;
}

export type NodePredicate<TData> = (node: TreeNode<TData>) => boolean;
