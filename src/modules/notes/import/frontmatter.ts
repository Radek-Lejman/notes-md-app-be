// The lazy `??` tries an empty block first, so `---\n---` never swallows a later `---`.
const FRONTMATTER = /^---[ \t]*\n(?:([\s\S]*?)\n)??(?:---|\.\.\.)[ \t]*(?:\n|$)/;
const TITLE_LINE = /^title:[ \t]*(.*)$/m;

export interface SplitFrontmatter {
  /** The YAML between the delimiters, or null when the file has no (closed) frontmatter. */
  frontmatter: string | null;
  body: string;
}

/** YAML frontmatter: `---` on the very first line, closed by `---` or `...`. */
export function splitFrontmatter(markdown: string): SplitFrontmatter {
  const match = FRONTMATTER.exec(markdown);
  if (!match) return { frontmatter: null, body: markdown };

  return { frontmatter: match[1] ?? '', body: markdown.slice(match[0].length) };
}

/**
 * The top-level scalar `title:`, without a YAML parser (no dependency). Block scalars, sequences
 * and mappings return null, so the file name is used instead.
 */
export function readTitle(frontmatter: string): string | null {
  const raw = TITLE_LINE.exec(frontmatter)?.[1].trim();
  if (!raw || /^[|>[{]/.test(raw)) return null;

  let title: string;
  if (raw.startsWith('"')) {
    title = raw.replace(/^"((?:\\.|[^"\\])*)".*$/, '$1').replace(/\\(.)/g, '$1');
  } else if (raw.startsWith("'")) {
    title = raw.replace(/^'((?:''|[^'])*)'.*$/, '$1').replace(/''/g, "'");
  } else {
    // In YAML a comment needs whitespace before `#`, so "C# basics" stays whole.
    title = raw.replace(/\s+#.*$/, '');
  }

  return title.trim() || null;
}

/**
 * The note content: the frontmatter kept losslessly as a ```yaml block before the body. Raw
 * `---` would be read by the editor as a horizontal rule and a setext heading.
 */
export function frontmatterToContent(frontmatter: string | null, body: string): string {
  if (frontmatter === null || frontmatter.trim() === '') return body;

  const runs: string[] = frontmatter.match(/`+/g) ?? [];
  const longestRun = Math.max(0, ...runs.map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const block = `${fence}yaml\n${frontmatter}\n${fence}`;
  const rest = body.replace(/^(?:[ \t]*\n)+/, '');

  return rest.trim() === '' ? block : `${block}\n\n${rest}`;
}
