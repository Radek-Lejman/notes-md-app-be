import { TreeNode, NodePredicate } from './tree.types';

export class TreeService<TData> {
  private root: TreeNode<TData>;
  private readonly byId = new Map<string, TreeNode<TData>>();

  private constructor(root: TreeNode<TData>) {
    this.root = root;
    this.indexNode(root);
  }

  static fromRoot<TData>(root: TreeNode<TData>): TreeService<TData> {
    return new TreeService<TData>(root);
  }

  getRoot(): TreeNode<TData> {
    return this.root;
  }

  getNode(id: string): TreeNode<TData> | undefined {
    return this.byId.get(id);
  }

  addChild(parentId: string, data: TData, newId: string): TreeNode<TData> {
    const parent = this.require(parentId);
    const node: TreeNode<TData> = { id: newId, parentId, data, children: [] };
    parent.children.push(node);
    this.indexNode(node);
    return node;
  }

  addChildren(parentId: string, kids: Array<{ id: string; data: TData }>): void {
    const parent = this.require(parentId);
    for (const kid of kids) {
      if (this.byId.has(kid.id)) continue;
      const node: TreeNode<TData> = { id: kid.id, parentId, data: kid.data, children: [] };
      parent.children.push(node);
      this.indexNode(node);
    }
  }

  updateNode(id: string, patch: Partial<TData>, parentId?: string | null): TreeNode<TData> {
    const node = this.require(id);
    node.data = { ...node.data, ...patch };
    if (parentId !== undefined) node.parentId = parentId;
    return node;
  }

  removeNode(id: string): void {
    const node = this.require(id);
    if (node.id === this.root.id) throw new Error('Cannot remove root');
    const parent = node.parentId ? this.require(node.parentId) : undefined;
    if (parent) parent.children = parent.children.filter((c) => c.id !== id);
    this.forEach((n) => this.byId.delete(n.id), id);
    this.byId.delete(id);
  }

  find(predicate: NodePredicate<TData>): TreeNode<TData> | undefined {
    let found: TreeNode<TData> | undefined;
    this.depthFirstSearch(this.root, (n) => {
      if (!found && predicate(n)) found = n;
    });
    return found;
  }

  private forEach(visitor: (n: TreeNode<TData>) => void, startId?: string): void {
    const start = startId ? this.require(startId) : this.root;
    this.depthFirstSearch(start, visitor);
  }

  private indexNode(node: TreeNode<TData>): void {
    this.byId.set(node.id, node);
    for (const childNode of node.children) this.indexNode(childNode);
  }

  private require(id: string): TreeNode<TData> {
    const node = this.byId.get(id);
    if (!node) throw new Error(`Node ${id} not found`);
    return node;
  }

  private depthFirstSearch(node: TreeNode<TData>, func: (x: TreeNode<TData>) => void): void {
    func(node);
    for (const childNode of node.children) this.depthFirstSearch(childNode, func);
  }
}
