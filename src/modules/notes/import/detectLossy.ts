import { maskCode } from './markdownScan';

export type LossyElement = 'table' | 'image' | 'html' | 'footnote';

const PATTERNS: [LossyElement, RegExp][] = [
  // The GFM delimiter row under the header: `| --- | :-: |`, at least one pipe.
  [
    'table',
    /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$|^ {0,3}\|[ \t]*:?-+:?[ \t]*\|[ \t]*$/m,
  ],
  ['image', /!\[(?:\\.|[^\\\]\n])*\]\(|!\[\[[^\]\n]+\]\]/],
  ['html', /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>|<!--/i],
  ['footnote', /\[\^[^\]\s]+\]/],
];

/**
 * Elements the editor cannot show: kept in the database, FTS and RAG, but dropped from the note
 * on its first edit in the app. Each kind is reported once per note; code is ignored.
 */
export function detectLossy(markdown: string): LossyElement[] {
  const masked = maskCode(markdown);
  return PATTERNS.filter(([, pattern]) => pattern.test(masked)).map(([element]) => element);
}
