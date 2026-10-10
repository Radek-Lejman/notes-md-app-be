import { tiptapToText } from '../utils/tiptapToText';
import { TiptapNode } from '../utils/tiptapToMarkdown';
import { markdownToPlainText, toWords } from '../utils/markdownText';

export interface ContentComparison {
  /** True when no word of the original document is missing from the markdown. */
  ok: boolean;
  /** Words of the original document that the markdown lost (with repetitions). */
  missing: string[];
  /** Words only the markdown has, e.g. page reference titles; informational. */
  extra: string[];
}

export function markdownToWords(markdown: string): string[] {
  return toWords(markdownToPlainText(markdown));
}

/** Multiset difference: every occurrence in `a` not matched by an occurrence in `b`. */
function difference(a: string[], b: string[]): string[] {
  const available = new Map<string, number>();
  b.forEach((word) => available.set(word, (available.get(word) ?? 0) + 1));

  return a.filter((word) => {
    const count = available.get(word) ?? 0;
    if (count === 0) return true;
    available.set(word, count - 1);
    return false;
  });
}

/** Checks that converting a Tiptap document to markdown kept all of its words. */
export function compareContent(json: TiptapNode | null, markdown: string): ContentComparison {
  const original = toWords(tiptapToText(json));
  const converted = markdownToWords(markdown);
  const missing = difference(original, converted);

  return { ok: missing.length === 0, missing, extra: difference(converted, original) };
}
