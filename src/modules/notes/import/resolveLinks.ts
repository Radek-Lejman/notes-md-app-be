import { maskCode } from './markdownScan';
import { escapeInline } from './markdownEscape';

export interface LinkTarget {
  id: string;
  /** The file path (or the folder path of a folder note). */
  segments: string[];
  title: string;
}

export type LinkWarningKind =
  | 'unresolved-link'
  | 'ambiguous-link'
  | 'unsafe-link'
  | 'attachment-skipped';

export interface LinkWarning {
  kind: LinkWarningKind;
  detail: string;
}

export interface ResolvedLinks {
  content: string;
  warnings: LinkWarning[];
  /** Notes some link now points to (decides which empty files are kept). */
  linkedIds: Set<string>;
}

export interface LinkIndex {
  byPath: Map<string, LinkTarget[]>;
  byBaseName: Map<string, LinkTarget[]>;
}

const IMPORTABLE_EXTENSION = /\.(?:md|markdown|txt)$/i;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);
// Wiki-link targets that are files rather than notes (embedded or linked attachments).
const ATTACHMENT_EXTENSION =
  /\.(?:png|jpe?g|gif|svg|webp|bmp|avif|heic|pdf|mp3|wav|ogg|m4a|flac|mp4|webm|mov|mkv|docx?|xlsx?|pptx?|odt|csv|zip|canvas|excalidraw)$/i;
const MAX_DETAIL_LENGTH = 200;

const LABEL = String.raw`(?:\\.|[^\\\[\]\n])`;
const DESTINATION = String.raw`<[^<>\n]*>|[^\s()<]*(?:\([^\s()]*\)[^\s()<]*)*`;
const LINK_TITLE = String.raw`(?:[ \t\n]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?`;
/**
 * One left-to-right pass, so overlapping syntax is taken by the alternative that starts
 * earliest: reference definitions, wiki links, inline links and images, autolinks.
 */
const LINK = new RegExp(
  [
    String.raw`(?<definition>^ {0,3}\[${LABEL}+\]:[ \t]*(?<defDest><[^<>\n]*>|\S+))`,
    String.raw`(?<wiki>(?<wikiEmbed>!?)\[\[(?<wikiInner>[^\[\]\n]+)\]\])`,
    String.raw`(?<inline>(?<inlineImage>!?)\[(?<inlineText>${LABEL}*)\]\([ \t]*(?<inlineDest>${DESTINATION})${LINK_TITLE}[ \t]*\))`,
    String.raw`(?<autolink><(?<autoDest>[a-z][a-z0-9+.-]{1,31}:[^\s<>]*)>)`,
  ].join('|'),
  'gimd',
);

const keyOf = (segments: string[]) => segments.join('/').normalize('NFC').toLowerCase();
const truncate = (text: string) =>
  text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text;

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
function pick(
  candidates: LinkTarget[] | undefined,
): { target: LinkTarget; ambiguous: boolean } | null {
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
function resolveTarget(raw: string, sourceDir: string[], index: LinkIndex) {
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

const NAMED_ENTITIES: Record<string, string> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  amp: '&',
};

/**
 * The scheme a browser would see after the markdown parser decoded entities and the URL parser
 * dropped whitespace and control characters (`java&#115;cript:`, `java\tscript:`).
 */
function schemeOf(destination: string): string | null {
  const decoded = destination
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16) % 0x110000),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec) % 0x110000))
    .replace(/&([a-z]+);/gi, (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity)
    // eslint-disable-next-line no-control-regex -- the URL parser strips these characters
    .replace(/[\u0000- \u007f]/g, '');
  const beforePath = decoded.split(/[/?#]/, 1)[0];
  if (!beforePath.includes(':')) return null;
  // An unknown named entity before the colon could still hide a scheme: treat it as unsafe.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(beforePath)?.[1].toLowerCase();
  return scheme && !beforePath.includes('&') ? scheme : 'unknown';
}

function decodePath(destination: string): string {
  const path = destination.replace(/[?#].*$/, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

const noteLink = (text: string, id: string) => `[${text}](/notes/${id})`;

/**
 * Rewrites links to imported files as links to their notes (`[Title](/notes/<uuid>)`), turns
 * links with unsafe schemes into plain text and reports what could not be resolved. Code is
 * left untouched. The text of existing markdown links is already markdown and is kept as it is;
 * text the import writes (titles, aliases) is escaped.
 */
export function resolveLinks(
  markdown: string,
  source: { id: string; segments: string[]; title: string },
  index: LinkIndex,
): ResolvedLinks {
  const warnings: LinkWarning[] = [];
  const linkedIds = new Set<string>();
  const sourceDir = source.segments.slice(0, -1);
  const self: LinkTarget = { id: source.id, segments: source.segments, title: source.title };

  const warn = (kind: LinkWarningKind, detail: string) =>
    warnings.push({ kind, detail: truncate(detail) });
  const found = (resolved: { target: LinkTarget; ambiguous: boolean }, detail: string) => {
    if (resolved.ambiguous) warn('ambiguous-link', detail);
    linkedIds.add(resolved.target.id);
    return resolved.target;
  };
  const range = (match: RegExpExecArray, group: string) => match.indices!.groups![group];
  const original = (match: RegExpExecArray, group: string) =>
    markdown.slice(...range(match, group));
  /** The whole match with one group replaced. */
  const withGroup = (match: RegExpExecArray, group: string, value: string) => {
    const [start, end] = range(match, group);
    return (
      markdown.slice(match.index, start) +
      value +
      markdown.slice(end, match.index + match[0].length)
    );
  };

  /** A relative destination: the note it points to, or null with the reason reported. */
  const resolveDestination = (destination: string, isImage: boolean, detail: string) => {
    const path = decodePath(destination);
    const fileName = path.split('/').pop() ?? '';
    const hasOtherExtension = /\.[^./]+$/.test(fileName) && !IMPORTABLE_EXTENSION.test(fileName);
    const resolved = hasOtherExtension ? null : resolveTarget(path, sourceDir, index);
    if (resolved) return found(resolved, detail);
    warn(isImage || hasOtherExtension ? 'attachment-skipped' : 'unresolved-link', detail);
    return null;
  };

  let result = '';
  let copied = 0;
  const masked = maskCode(markdown);

  for (const match of masked.matchAll(LINK)) {
    const groups = match.groups!;
    const whole = markdown.slice(match.index, match.index + match[0].length);
    let replacement: string | null = null;

    if (groups.definition !== undefined) {
      const destination = original(match, 'defDest').replace(/^<|>$/g, '');
      const scheme = schemeOf(destination);
      if (scheme !== null) {
        if (!SAFE_SCHEMES.has(scheme)) {
          warn('unsafe-link', destination);
          replacement = withGroup(match, 'defDest', '#');
        }
      } else if (!destination.startsWith('/') && !destination.startsWith('#')) {
        const target = resolveDestination(destination, false, whole.trim());
        if (target) replacement = withGroup(match, 'defDest', `/notes/${target.id}`);
      }
    } else if (groups.wiki !== undefined) {
      const inner = original(match, 'wikiInner').replace(/\\\|/g, '|');
      const pipe = inner.indexOf('|');
      const alias = pipe === -1 ? '' : inner.slice(pipe + 1).trim();
      const [name, ...anchor] = (pipe === -1 ? inner : inner.slice(0, pipe)).split('#');
      const heading = anchor.join('#').trim();

      const resolved =
        name.trim() === ''
          ? { target: self, ambiguous: false }
          : resolveTarget(name, sourceDir, index);
      if (resolved) {
        const target = found(resolved, whole);
        const text =
          alias ||
          (heading && !heading.startsWith('^') ? `${target.title} › ${heading}` : target.title);
        replacement = noteLink(escapeInline(text), target.id);
      } else {
        const isAttachment = ATTACHMENT_EXTENSION.test(name.trim()) || groups.wikiEmbed === '!';
        warn(isAttachment ? 'attachment-skipped' : 'unresolved-link', whole);
      }
    } else if (groups.inline !== undefined) {
      const text = original(match, 'inlineText');
      const destination = original(match, 'inlineDest').replace(/^<|>$/g, '');
      const isImage = groups.inlineImage === '!';
      const scheme = schemeOf(destination);
      if (scheme !== null) {
        if (!SAFE_SCHEMES.has(scheme)) {
          warn('unsafe-link', destination);
          replacement = text;
        }
      } else if (
        destination !== '' &&
        !destination.startsWith('/') &&
        !destination.startsWith('#')
      ) {
        const target = resolveDestination(destination, isImage, whole);
        if (target) replacement = noteLink(text, target.id);
      }
    } else {
      const destination = original(match, 'autoDest');
      if (!SAFE_SCHEMES.has(schemeOf(destination) ?? '')) {
        warn('unsafe-link', destination);
        replacement = escapeInline(destination);
      }
    }

    if (replacement !== null) {
      result += markdown.slice(copied, match.index) + replacement;
      copied = match.index + match[0].length;
    }
  }

  return { content: result + markdown.slice(copied), warnings, linkedIds };
}
