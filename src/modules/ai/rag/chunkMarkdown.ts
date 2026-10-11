export interface NoteChunkDraft {
  /** "Title > Heading > Subheading" */
  headingPath: string;
  content: string;
}

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

interface Section {
  headingPath: string;
  text: string;
}

// Closing #s count only after a space (CommonMark): "## C#" is "C#", "## Title ##" is "Title".
const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Splits a markdown note into chunks for embedding: one section per heading
 * (headings inside code blocks are ignored), long sections split by paragraphs,
 * and paragraphs longer than chunkSize split hard, with overlap.
 */
export function chunkMarkdown(
  title: string,
  markdown: string,
  options: ChunkOptions,
): NoteChunkDraft[] {
  return splitSections(title, markdown).flatMap((section) =>
    splitText(section.text, options).map((content) => ({
      headingPath: section.headingPath,
      content,
    })),
  );
}

/** Text that is embedded: the heading path gives each chunk the note's context. */
export function embeddingText(chunk: NoteChunkDraft): string {
  return `${chunk.headingPath}\n\n${chunk.content}`;
}

function splitSections(title: string, markdown: string): Section[] {
  const rootTitle = title.trim() || 'Untitled';
  const sections: Section[] = [];
  const headings: { level: number; text: string }[] = [];
  let lines: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) {
      const headingPath = [rootTitle, ...headings.map((h) => h.text)].join(' > ');
      sections.push({ headingPath, text });
    }
    lines = [];
  };

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: heading[2] });
    }
    lines.push(line);
  }
  flush();

  return sections;
}

function splitText(text: string, { chunkSize, chunkOverlap }: ChunkOptions): string[] {
  if (text.length <= chunkSize) return [text];

  const pieces = text
    .split(/\n{2,}/)
    .flatMap((paragraph) => hardSplit(paragraph.trim(), chunkSize, chunkOverlap))
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + 2 + piece.length > chunkSize) {
      chunks.push(current);
      const tail = chunkOverlap ? current.slice(-chunkOverlap) : '';
      current = tail && tail.length + 2 + piece.length <= chunkSize ? `${tail}\n\n${piece}` : piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function hardSplit(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];
  const step = Math.max(1, size - overlap);
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    parts.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return parts;
}
