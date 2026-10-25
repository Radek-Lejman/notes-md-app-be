/** Replaces every code unit inside code; a private-use character never typed in notes. */
export const CODE_MASK = '';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const INDENTED = /^(?: {4}| {0,3}\t)/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;

const mask = (text: string) => text.replace(/[^\n]/g, CODE_MASK);
const isBlank = (line: string) => line.trim() === '';

/**
 * The markdown with fenced code blocks, indented code blocks and code spans replaced by
 * `CODE_MASK`. The result has the same length and line breaks, so a match found in it points at
 * the same place in the original: search the masked text, slice the original.
 *
 * A line scanner, not a full CommonMark parser. Known simplifications: code inside block quotes
 * is not detected, and an indented line inside a list is list content (nested items), never code.
 */
export function maskCode(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let fence: { char: string; length: number } | null = null;
  let inIndentedCode = false;
  let inList = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) out.push(...maskCodeSpans(paragraph.join('\n')).split('\n'));
    paragraph = [];
  };

  lines.forEach((line, index) => {
    const previousBlank = index === 0 || isBlank(lines[index - 1]);

    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      out.push(mask(line));
      return;
    }

    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      flushParagraph();
      fence = { char: open[1][0], length: open[1].length };
      inIndentedCode = false;
      out.push(mask(line));
      return;
    }

    if (isBlank(line)) {
      flushParagraph();
      out.push(line);
      return;
    }

    if (INDENTED.test(line) && (inIndentedCode || (previousBlank && !inList))) {
      flushParagraph();
      inIndentedCode = true;
      out.push(mask(line));
      return;
    }

    inIndentedCode = false;
    if (LIST_ITEM.test(line)) inList = true;
    // A paragraph after a blank line ends the list; without one it is a lazy continuation.
    else if (!INDENTED.test(line) && previousBlank) inList = false;
    paragraph.push(line);
  });

  flushParagraph();
  return out.join('\n');
}

/**
 * Masks code spans in one paragraph: a run of N backticks closes at the next run of exactly N.
 * An unmatched run stays literal. Linear: each length keeps a pointer into its own list of runs.
 */
function maskCodeSpans(text: string): string {
  const runs: { start: number; length: number; escaped: boolean }[] = [];
  for (const match of text.matchAll(/`+/g)) {
    const start = match.index;
    let backslashes = 0;
    while (text[start - 1 - backslashes] === '\\') backslashes++;
    runs.push({ start, length: match[0].length, escaped: backslashes % 2 === 1 });
  }
  if (runs.length < 2) return text;

  const byLength = new Map<number, number[]>();
  runs.forEach((run, index) => {
    const list = byLength.get(run.length) ?? [];
    list.push(index);
    byLength.set(run.length, list);
  });
  const pointers = new Map<number, number>();

  let result = '';
  let copied = 0;
  for (let index = 0; index < runs.length; index++) {
    const opener = runs[index];
    // Escaped openers are skipped; inside a span a backslash is literal, so closers may follow one.
    if (opener.start < copied || opener.escaped) continue;

    const candidates = byLength.get(opener.length)!;
    let pointer = pointers.get(opener.length) ?? 0;
    while (pointer < candidates.length && candidates[pointer] <= index) pointer++;
    pointers.set(opener.length, pointer);
    if (pointer === candidates.length) continue;

    const end = runs[candidates[pointer]].start + opener.length;
    result += text.slice(copied, opener.start) + mask(text.slice(opener.start, end));
    copied = end;
  }

  return result + text.slice(copied);
}
