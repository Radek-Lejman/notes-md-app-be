import { MAX_CONTENT_LENGTH } from '../consts/validator.consts';
import { buildImportTree } from './buildImportTree';
import { detectLossy } from './detectLossy';
import { frontmatterToContent, readTitle, splitFrontmatter } from './frontmatter';
import { isImportablePath, normalizeImportPath } from './importPath';
import {
  IMPORT_MODE,
  IMPORT_SKIP_REASON,
  ImportFileInput,
  ImportMode,
  ImportPlan,
  ImportReport,
} from './importPlan.types';
import { fileTitle, folderTitle, importTitle, UNTITLED_NOTE_TITLE } from './importTitle';
import { createLinkIndex, LinkTarget } from './linkIndex';
import { resolveLinks } from './resolveLinks';
import { splitByH1 } from './splitCombined';

/** The input cannot be imported as a whole; the message names the file. */
export class ImportPlanError extends Error {}

interface AcceptedFile {
  path: string;
  segments: string[];
  frontmatter: string | null;
  body: string;
  /** The H1 text of a `split-h1` section; it replaces the file-name title. */
  title?: string;
}

const MAX_REPORTED_PATH_LENGTH = 300;
const reportedPath = (path: string) => path.slice(0, MAX_REPORTED_PATH_LENGTH);
const sortKey = (path: string) => path.normalize('NFC').replace(/\\/g, '/');
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Turns the uploaded files into the notes to create: filters what cannot be imported, builds
 * the tree under one root note, assigns titles, rewrites links and reports everything it
 * skipped or changed. Pure and deterministic for a deterministic `newId`: the browser's file
 * order does not matter, the input is sorted by path first.
 */
export function planImport(
  input: { files: ImportFileInput[]; mode: ImportMode; rootTitle: string },
  newId: () => string,
): ImportPlan {
  const skipped: ImportReport['skipped'] = [];
  const warnings: ImportReport['warnings'] = [];

  let files = [...input.files].sort(
    (a, b) => byCodePoint(sortKey(a.path), sortKey(b.path)) || byCodePoint(a.content, b.content),
  );
  let sectionTitles: string[] | null = null;

  if (input.mode === IMPORT_MODE.splitH1) {
    if (files.length !== 1) {
      throw new ImportPlanError('Splitting by H1 needs exactly one file');
    }
    const [file] = files;
    const path = normalizeImportPath(file.path);
    if (path.ok && isImportablePath(file.path) && !file.content.includes('\u0000')) {
      const sections = splitByH1(file.content, path.segments[path.segments.length - 1]);
      files = sections.map(({ path, content }) => ({ path, content }));
      sectionTitles = sections.map((section) => section.title);
    }
  }

  const accepted: AcceptedFile[] = [];
  files.forEach((file, index) => {
    const path = normalizeImportPath(file.path);
    if (!path.ok) {
      skipped.push({ path: reportedPath(file.path), reason: path.reason });
    } else if (!isImportablePath(file.path)) {
      skipped.push({ path: reportedPath(file.path), reason: IMPORT_SKIP_REASON.notMarkdown });
    } else if (file.content.includes('\u0000')) {
      // A binary file named `.md`; Postgres `text` does not accept NUL either.
      skipped.push({ path: reportedPath(file.path), reason: IMPORT_SKIP_REASON.binary });
    } else {
      const { frontmatter, body } = splitFrontmatter(file.content);
      accepted.push({
        path: path.segments.join('/'),
        segments: path.segments,
        frontmatter,
        body,
        title: sectionTitles?.[index],
      });
    }
  });

  const tree = buildImportTree(accepted, newId);
  for (const index of tree.duplicates) {
    skipped.push({
      path: reportedPath(accepted[index].path),
      reason: IMPORT_SKIP_REASON.duplicatePath,
    });
  }

  // Titles first: links written by the import show the title of the note they point to.
  const titles = tree.nodes.map((node) => {
    const file = node.fileIndex === null ? null : accepted[node.fileIndex];
    const fromFrontmatter = file?.frontmatter ? readTitle(file.frontmatter) : null;
    const name = node.segments[node.segments.length - 1] ?? '';

    const { title, warning } =
      node.kind === 'root'
        ? importTitle(input.rootTitle, 'Import')
        : node.kind === 'folder'
          ? importTitle(fromFrontmatter ?? folderTitle(name), UNTITLED_NOTE_TITLE)
          : importTitle(
              file?.title ?? fromFrontmatter ?? fileTitle(name),
              folderTitle(node.segments[node.segments.length - 2] ?? '') || UNTITLED_NOTE_TITLE,
            );
    if (warning) warnings.push({ path: file?.path ?? name, kind: warning, detail: title });
    return title;
  });

  // A folder note answers to the folder's path and to its own file's path.
  const targets: LinkTarget[] = tree.nodes.flatMap((node, index) => {
    if (node.kind === 'root') return [];
    const own = { id: node.id, segments: node.segments, title: titles[index] };
    const file = node.fileIndex === null ? null : accepted[node.fileIndex];
    return file && node.kind === 'folder' ? [own, { ...own, segments: file.segments }] : [own];
  });
  const linkIndex = createLinkIndex(targets);

  const linkedIds = new Set<string>();
  const contents = tree.nodes.map((node, index) => {
    if (node.fileIndex === null) return { content: '', isEmpty: true };
    const file = accepted[node.fileIndex];
    const resolved = resolveLinks(
      file.body,
      { id: node.id, segments: file.segments, title: titles[index] },
      linkIndex,
    );
    resolved.linkedIds.forEach((id) => id !== node.id && linkedIds.add(id));
    for (const warning of resolved.warnings) warnings.push({ path: file.path, ...warning });
    for (const element of detectLossy(resolved.content)) {
      warnings.push({ path: file.path, kind: 'lossy-content', detail: element });
    }

    const content = frontmatterToContent(file.frontmatter, resolved.content);
    if (content.length > MAX_CONTENT_LENGTH) {
      // Link rewriting makes content longer; skipping it would leave links to a missing note.
      throw new ImportPlanError(`${file.path} is too long after rewriting its links`);
    }
    return { content, isEmpty: file.body.trim() === '' };
  });

  // Empty files nothing links to are skipped; so are folders left with nothing in them.
  // Reverse preorder visits children before their parents.
  const removed = new Set<string>();
  const childCount = new Map<string, number>();
  for (let index = tree.nodes.length - 1; index >= 0; index--) {
    const node = tree.nodes[index];
    const keep =
      node.kind === 'root' ||
      !contents[index].isEmpty ||
      linkedIds.has(node.id) ||
      (childCount.get(node.id) ?? 0) > 0;

    if (keep) {
      if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
    } else {
      removed.add(node.id);
      if (node.fileIndex !== null) {
        skipped.push({
          path: reportedPath(accepted[node.fileIndex].path),
          reason: IMPORT_SKIP_REASON.empty,
        });
      }
    }
  }

  const notes = tree.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => !removed.has(node.id))
    .map(({ node, index }, order) => ({
      id: node.id,
      parentId: node.parentId,
      title: titles[index],
      content: contents[index].content,
      order,
    }));

  return { notes, report: { created: notes.length, skipped, warnings } };
}
