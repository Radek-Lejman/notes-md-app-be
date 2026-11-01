import { buildImportTree, TreeNode } from './buildImportTree';

const sequentialIds = () => {
  let next = 0;
  return () => `id-${next++}`;
};

const build = (paths: string[]) =>
  buildImportTree(
    paths.map((path) => ({ segments: path.split('/') })),
    sequentialIds(),
  );

/** `path (kind) <- parent path`, in output order; `fileIndex` shown when it differs from a file's own. */
const describeNodes = (nodes: TreeNode[], paths: string[]) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const parent = node.parentId ? byId.get(node.parentId)!.segments.join('/') || '/' : null;
    const own = node.segments.join('/') || '/';
    const file = node.fileIndex === null ? '' : ` = ${paths[node.fileIndex]}`;
    return `${own} (${node.kind})${file}${parent ? ` <- ${parent}` : ''}`;
  });
};

describe('buildImportTree', () => {
  it('puts flat files under the root', () => {
    const paths = ['b.md', 'a.md'];
    expect(describeNodes(build(paths).nodes, paths)).toEqual([
      '/ (root)',
      'a.md (file) = a.md <- /',
      'b.md (file) = b.md <- /',
    ]);
  });

  it('creates folder notes with a parentId chain', () => {
    const paths = ['A/B/c.md'];
    expect(describeNodes(build(paths).nodes, paths)).toEqual([
      '/ (root)',
      'A (folder) <- /',
      'A/B (folder) <- A',
      'A/B/c.md (file) = A/B/c.md <- A/B',
    ]);
  });

  it('merges Folder/index.md into the folder note', () => {
    const paths = ['A/index.md', 'A/x.md'];
    expect(describeNodes(build(paths).nodes, paths)).toEqual([
      '/ (root)',
      'A (folder) = A/index.md <- /',
      'A/x.md (file) = A/x.md <- A',
    ]);
  });

  it('merges Folder.md next to Folder/ into the folder note', () => {
    const paths = ['A.md', 'A/x.md'];
    expect(describeNodes(build(paths).nodes, paths)).toEqual([
      '/ (root)',
      'A (folder) = A.md <- /',
      'A/x.md (file) = A/x.md <- A',
    ]);
  });

  it('prefers index.md and keeps Folder.md as a regular note, in any input order', () => {
    for (const paths of [
      ['A.md', 'A/index.md', 'A/x.md'],
      ['A/x.md', 'A/index.md', 'A.md'],
    ]) {
      const lines = describeNodes(build(paths).nodes, paths);
      expect(lines).toEqual([
        '/ (root)',
        'A (folder) = A/index.md <- /',
        'A/x.md (file) = A/x.md <- A',
        'A.md (file) = A.md <- /',
      ]);
    }
  });

  it('keeps a root-level index.md as a regular note', () => {
    const paths = ['index.md'];
    expect(describeNodes(build(paths).nodes, paths)).toEqual([
      '/ (root)',
      'index.md (file) = index.md <- /',
    ]);
  });

  it('matches folder notes and folders ignoring case', () => {
    const paths = ['projects.md', 'Projects/a.md', 'PROJECTS/b.md'];
    const lines = describeNodes(build(paths).nodes, paths);

    expect(lines[1]).toBe('Projects (folder) = projects.md <- /');
    expect(lines.slice(2)).toEqual([
      'Projects/a.md (file) = Projects/a.md <- Projects',
      'PROJECTS/b.md (file) = PROJECTS/b.md <- Projects',
    ]);
  });

  it('sorts folders and files together, case-insensitively, numbers by value', () => {
    const paths = ['b.md', 'C/x.md', 'a.md', 'Note 10.md', 'Note 2.md', 'B2.md'];
    expect(
      build(paths)
        .nodes.slice(1)
        .filter((node) => node.parentId === 'id-0')
        .map((node) => node.segments.join('/')),
    ).toEqual(['a.md', 'b.md', 'B2.md', 'C', 'Note 2.md', 'Note 10.md']);
  });

  it('lists parents before children and assigns ids in output order', () => {
    const { nodes } = build(['z/y/x.md', 'a/b.md', 'm.md']);
    const position = new Map(nodes.map((node, index) => [node.id, index]));

    nodes.forEach((node, index) => {
      expect(node.id).toBe(`id-${index}`);
      if (node.parentId) expect(position.get(node.parentId)).toBeLessThan(index);
    });
  });

  it('skips duplicate paths (ignoring case), keeping the first', () => {
    const paths = ['A/x.md', 'a/X.md', 'b.md'];
    const { nodes, duplicates } = build(paths);

    expect(duplicates).toEqual([1]);
    expect(nodes.filter((node) => node.kind === 'file').map((node) => node.fileIndex)).toEqual([
      0, 2,
    ]);
  });

  it('returns only the root for no files', () => {
    expect(build([]).nodes).toEqual([
      { id: 'id-0', parentId: null, kind: 'root', segments: [], fileIndex: null },
    ]);
  });
});
