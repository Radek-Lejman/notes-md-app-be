import { IMPORTABLE_EXTENSION } from './importPath';

export interface LinkTarget {
  id: string;
  /** The file path (or the folder path of a folder note). */
  segments: string[];
  title: string;
}

export interface LinkIndex {
  byPath: Map<string, LinkTarget[]>;
  byBaseName: Map<string, LinkTarget[]>;
}

export interface ResolvedTarget {
  target: LinkTarget;
  ambiguous: boolean;
}

const keyOf = (segments: string[]) => segments.join('/').normalize('NFC').toLowerCase();

function addTo(map: Map<string, LinkTarget[]>, key: string, target: LinkTarget) {
  const list = map.get(key) ?? [];
  if (!list.some((existing) => existing.id === target.id)) list.push(target);
  map.set(key, list);
}

export function createLinkIndex(targets: LinkTarget[]): LinkIndex {
  const byPath = new Map<string, LinkTarget[]>();
  const byBaseName = new Map<string, LinkTarget[]>();
  for (const target of targets) {
    const segments = [...target.segments];
    segments[segments.length - 1] = segments[segments.length - 1].replace(IMPORTABLE_EXTENSION, '');
    addTo(byPath, keyOf(segments), target);
    addTo(byBaseName, keyOf(segments.slice(-1)), target);
  }
  return { byPath, byBaseName };
}

/** `a/./b/../c` relative to `dir`; null when it climbs above the import root. */
function joinPath(dir: string[], path: string[]): string[] | null {
  const result = [...dir];
  for (const segment of path) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (result.length === 0) return null;
      result.pop();
    } else {
      result.push(segment);
    }
  }
  return result;
}

/** Shortest path wins, then the lexicographically first; more than one candidate is ambiguous. */
function pick(candidates: LinkTarget[] | undefined): ResolvedTarget | null {
  if (!candidates || candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const ka = keyOf(a.segments);
    const kb = keyOf(b.segments);
    return ka.length - kb.length || (ka < kb ? -1 : ka > kb ? 1 : 0);
  });
  return { target: sorted[0], ambiguous: sorted.length > 1 };
}

/**
 * Obsidian-style resolution of a link target (no anchor, decoded): relative to the source
 * file, from the import root, by path suffix, by base name. Case-insensitive, NFC.
 */
export function resolveTarget(
  raw: string,
  sourceDir: string[],
  index: LinkIndex,
): ResolvedTarget | null {
  const path = raw.normalize('NFC').replace(/\\/g, '/').trim().replace(IMPORTABLE_EXTENSION, '');
  const segments = path.split('/');
  if (segments.every((segment) => segment === '' || segment === '.')) return null;

  const relative = joinPath(sourceDir, segments);
  const fromRoot = joinPath([], segments);
  const exact =
    pick(relative ? index.byPath.get(keyOf(relative)) : undefined) ??
    pick(fromRoot ? index.byPath.get(keyOf(fromRoot)) : undefined);
  if (exact) return exact;

  const wanted = (fromRoot ?? segments).filter((segment) => segment !== '');
  const byBase = index.byBaseName.get(keyOf(wanted.slice(-1)));
  if (wanted.length === 1) return pick(byBase);

  const suffix = `/${keyOf(wanted)}`;
  return pick(byBase?.filter((target) => `/${keyOf(target.segments)}`.endsWith(suffix)));
}
