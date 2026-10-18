const FENCE_LINE = /^ {0,3}(`{3,}|~{3,}).*$/gm;
const LINK = /!?\[((?:\\.|[^\\\]])*)\]\([^)\s]*\)/g;
const NBSP = /&(?:nbsp|#160);/gi;
const TASK_MARKER = /^([ \t]*[-+*][ \t]+)\[[ xX]\](?=[ \t]|$)/gm;
const BLOCK_MARKER = /^[ \t]*(?:#{1,6}|>|[-+*]|\d+[.)])(?=[ \t]|$)/gm;
const THEMATIC_BREAK = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm;
const UNESCAPED_DELIMITER = /(?<!\\)[*_~`]+/g;
const ESCAPED = /\\([!-/:-@[-`{-~])/g;
const HARD_BREAK = /\\\n/g;
const HTML_TAG = /(?<!\\)<\/?[a-z][^>]*>/gi;

/** Readable plain text of a markdown note (for snippets and word comparison). */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(FENCE_LINE, '')
    .replace(LINK, '$1')
    .replace(HTML_TAG, '')
    .replace(NBSP, ' ')
    .replace(HARD_BREAK, '\n')
    .replace(THEMATIC_BREAK, '')
    .replace(TASK_MARKER, '$1')
    .replace(BLOCK_MARKER, '')
    .replace(UNESCAPED_DELIMITER, '')
    .replace(ESCAPED, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower-cased words (letters and digits, Unicode aware) in document order. */
export function toWords(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Ł/ł have no decomposition, so NFD alone leaves them as they are. */
const STROKE_LETTERS: Record<string, string> = { ł: 'l', Ł: 'L' };

/**
 * Removes diacritics ("Żółw" -> "Zolw"), like the `simple_unaccent` search configuration.
 * Keeps the string length (one UTF-16 unit in, one out), so indexes found in the result point
 * at the same place in the original text.
 */
export function foldDiacritics(text: string): string {
  return text.replace(/[\u0080-\uffff]/g, (char) => {
    const folded = STROKE_LETTERS[char] ?? char.normalize('NFD').replace(/\p{M}/gu, '');
    return folded.length === 1 ? folded : char;
  });
}

export const SNIPPET_LENGTH = 160;
const SNIPPET_CONTEXT = 40;

/**
 * A short plain-text excerpt around the first word matching the query (prefix match ignoring
 * diacritics, like the FTS query). Falls back to the beginning of the note. HTML tags from the
 * note are removed.
 */
export function buildSnippet(markdown: string, query: string, maxLength = SNIPPET_LENGTH): string {
  const text = markdownToPlainText(markdown);
  if (text.length <= maxLength) return text;

  // Searched case-insensitively in a same-length folded copy: lower-casing can change string
  // length (e.g. "İ"), so `text` itself is never lower-cased.
  const folded = foldDiacritics(text);
  const hits = toWords(foldDiacritics(query))
    .map((term) => folded.search(new RegExp(`(?<![\\p{L}\\p{N}])${term}`, 'iu')))
    .filter((index) => index >= 0);
  const hit = hits.length > 0 ? Math.min(...hits) : 0;

  let start = Math.max(0, hit - SNIPPET_CONTEXT);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  const end = Math.min(text.length, start + maxLength);

  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
