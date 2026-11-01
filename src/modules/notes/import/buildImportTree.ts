import { IMPORTABLE_EXTENSION } from './importPath';

export type TreeNodeKind = 'root' | 'folder' | 'file';

export interface TreeNode {
  id: string;
  /** null only for the root; the service puts the checked `targetParentId` there. */
  parentId: string | null;
  kind: TreeNodeKind;
  /** The folder or file path; `[]` for the root. */
  segments: string[];
  /** The input file whose content the note gets: a file, or the folder note merged into a folder. */
  fileIndex: number | null;
}

export interface ImportTree {
  /** Parents before children (preorder); a node's index is its sibling order. */
  nodes: TreeNode[];
  /** Input indexes skipped because the same path (ignoring case) came earlier. */
  duplicates: number[];
}

interface Folder {
  segments: string[];
  noteFile: { index: number; isIndex: boolean } | null;
  folders: Folder[];
  files: number[];
}

const keyOf = (segments: string[]) => segments.join('/').toLowerCase();
const baseName = (name: string) => name.replace(IMPORTABLE_EXTENSION, '');
const sortKey = (name: string) => baseName(name).toLocaleLowerCase();

/** Case-insensitive, numbers by value ("2" before "10"); raw order breaks ties for determinism. */
function compareNames(a: string, b: string): number {
  const byLocale = sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true });
  if (byLocale !== 0) return byLocale;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Turns file paths into a note tree: every folder is a note, files are its children. A folder
 * note (`Folder/index.md`, or `Folder.md` next to `Folder/`) gives its content to the folder's
 * note instead of becoming a separate child; `index.md` wins when both exist. Ids come from
 * `newId` in output order, so the result is deterministic for a deterministic `newId`.
 */
export function buildImportTree(files: { segments: string[] }[], newId: () => string): ImportTree {
  const root: Folder = { segments: [], noteFile: null, folders: [], files: [] };
  const folders = new Map<string, Folder>([['', root]]);
  const seen = new Set<string>();
  const duplicates: number[] = [];
  const accepted: number[] = [];

  const folderAt = (segments: string[]): Folder => {
    const key = keyOf(segments);
    let folder = folders.get(key);
    if (!folder) {
      const parent = folderAt(segments.slice(0, -1));
      folder = { segments, noteFile: null, folders: [], files: [] };
      parent.folders.push(folder);
      folders.set(key, folder);
    }
    return folder;
  };

  files.forEach(({ segments }, index) => {
    const key = keyOf(segments);
    if (seen.has(key)) {
      duplicates.push(index);
      return;
    }
    seen.add(key);
    accepted.push(index);
    folderAt(segments.slice(0, -1));
  });

  const parentOf = (index: number) => folders.get(keyOf(files[index].segments.slice(0, -1)))!;

  // Folders exist only now, so `Folder.md` can be matched however the input was ordered.
  for (const index of accepted) {
    const segments = files[index].segments;
    const parentSegments = segments.slice(0, -1);
    const base = baseName(segments[segments.length - 1]);

    const isIndex = base.toLowerCase() === 'index' && segments.length > 1;
    const target = isIndex
      ? folders.get(keyOf(parentSegments))
      : folders.get(keyOf([...parentSegments, base]));

    if (target && target !== root && (!target.noteFile || (isIndex && !target.noteFile.isIndex))) {
      // `index.md` wins: a `Folder.md` merged before it goes back to being a regular note.
      if (target.noteFile) parentOf(target.noteFile.index).files.push(target.noteFile.index);
      target.noteFile = { index, isIndex };
    } else {
      parentOf(index).files.push(index);
    }
  }

  const nodes: TreeNode[] = [];
  const visit = (folder: Folder, kind: TreeNodeKind, parentId: string | null) => {
    const id = newId();
    nodes.push({
      id,
      parentId,
      kind,
      segments: folder.segments,
      fileIndex: folder.noteFile?.index ?? null,
    });

    const children = [
      ...folder.folders.map((child) => ({ name: child.segments.at(-1)!, folder: child })),
      ...folder.files.map((index) => ({ name: files[index].segments.at(-1)!, index })),
    ].sort((a, b) => compareNames(a.name, b.name));

    for (const child of children) {
      if ('folder' in child) {
        visit(child.folder, 'folder', id);
      } else {
        nodes.push({
          id: newId(),
          parentId: id,
          kind: 'file',
          segments: files[child.index].segments,
          fileIndex: child.index,
        });
      }
    }
  };
  visit(root, 'root', null);

  return { nodes, duplicates };
}
