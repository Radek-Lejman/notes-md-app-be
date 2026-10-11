import { TreeService } from './tree.service';
import { TreeNode } from './tree.types';

type Data = { title: string };

const node = (id: string, parentId: string | null, children: TreeNode<Data>[] = []) => ({
  id,
  parentId,
  data: { title: id.toUpperCase() },
  children,
});

/** root ─┬─ a ── a1
 *        └─ b */
const makeTree = () =>
  TreeService.fromRoot<Data>(
    node('root', null, [node('a', 'root', [node('a1', 'a')]), node('b', 'root')]),
  );

const ids = (n: TreeNode<Data>): unknown => ({ [n.id]: n.children.map(ids) });

describe('TreeService', () => {
  it('indexes every node of the initial tree by id', () => {
    const tree = makeTree();

    expect(tree.getRoot().id).toBe('root');
    expect(tree.getNode('a1')?.data.title).toBe('A1');
    expect(tree.getNode('missing')).toBeUndefined();
  });

  it('addChild appends a node under its parent and indexes it', () => {
    const tree = makeTree();

    const added = tree.addChild('b', { title: 'B1' }, 'b1');

    expect(added).toEqual({ id: 'b1', parentId: 'b', data: { title: 'B1' }, children: [] });
    expect(tree.getNode('b1')).toBe(added);
    expect(ids(tree.getRoot())).toEqual({
      root: [{ a: [{ a1: [] }] }, { b: [{ b1: [] }] }],
    });
  });

  it('addChildren adds new nodes and skips ids already in the tree', () => {
    const tree = makeTree();

    tree.addChildren('b', [
      { id: 'b1', data: { title: 'B1' } },
      { id: 'a1', data: { title: 'duplicate' } },
      { id: 'b2', data: { title: 'B2' } },
    ]);

    expect(tree.getNode('b')?.children.map((c) => c.id)).toEqual(['b1', 'b2']);
    expect(tree.getNode('a1')?.data.title).toBe('A1');
  });

  it.each([
    ['addChild', (t: TreeService<Data>) => t.addChild('ghost', { title: 'x' }, 'x')],
    ['addChildren', (t: TreeService<Data>) => t.addChildren('ghost', [])],
    ['updateNode', (t: TreeService<Data>) => t.updateNode('ghost', {})],
    ['removeNode', (t: TreeService<Data>) => t.removeNode('ghost')],
  ])('%s throws for an unknown node', (_name, call) => {
    expect(() => call(makeTree())).toThrow('Node ghost not found');
  });

  it('updateNode merges the patch into the data', () => {
    const tree = makeTree();

    const updated = tree.updateNode('a', { title: 'Renamed' });

    expect(updated.data).toEqual({ title: 'Renamed' });
    expect(updated.parentId).toBe('root');
  });

  it('updateNode changes the parent reference only when given', () => {
    const tree = makeTree();

    expect(tree.updateNode('a1', {}, 'b').parentId).toBe('b');
    expect(tree.updateNode('a1', {}, null).parentId).toBeNull();
    expect(tree.updateNode('a1', {}).parentId).toBeNull();
  });

  it('removeNode detaches the node and forgets its whole subtree', () => {
    const tree = makeTree();

    tree.removeNode('a');

    expect(ids(tree.getRoot())).toEqual({ root: [{ b: [] }] });
    expect(tree.getNode('a')).toBeUndefined();
    expect(tree.getNode('a1')).toBeUndefined();
    expect(() => tree.addChild('a1', { title: 'x' }, 'x')).toThrow('Node a1 not found');
  });

  it('removeNode refuses to remove the root', () => {
    expect(() => makeTree().removeNode('root')).toThrow('Cannot remove root');
  });

  it('find returns the first match in depth-first order', () => {
    const tree = makeTree();

    expect(tree.find((n) => n.id.startsWith('a'))?.id).toBe('a');
    expect(tree.find((n) => n.parentId === 'a')?.id).toBe('a1');
    expect(tree.find(() => false)).toBeUndefined();
  });
});
