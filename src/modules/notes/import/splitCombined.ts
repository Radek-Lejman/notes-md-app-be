import { markdownToPlainText } from '../utils/markdownText';
import { maskCode } from './markdownScan';
import { fileTitle } from './importTitle';
import { UNTITLED_NOTE_TITLE } from '../consts/import.consts';

export interface SplitSection {
  /** A flat, unique file path for link resolution: "<safe title>.md". */
  path: string;
  /** The heading text, kept even when the path had to replace characters ("CI/CD"). */
  title: string;
  content: string;
}

// ATX H1 only: `# Title`, optional closing `#`s. Setext (`Title\n===`) is not split on.
const H1 = /^ {0,3}#(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/gm;

/**
 * "One file, split by H1": each `# Heading` starts a new note (the heading line stays in its
 * content). Text before the first H1 becomes a note named after the file. Headings in code do
 * not split.
 */
export function splitByH1(markdown: string, fileName: string): SplitSection[] {
  const masked = maskCode(markdown);
  const starts = [...masked.matchAll(H1)].map((match) => match.index);
  const sections: { title: string; content: string }[] = [];

  const intro = markdown.slice(0, starts[0] ?? markdown.length);
  if (intro.trim() !== '') sections.push({ title: fileTitle(fileName), content: intro });

  starts.forEach((start, index) => {
    const content = markdown.slice(start, starts[index + 1] ?? markdown.length);
    const heading = content.split('\n', 1)[0].replace(/^ {0,3}#[ \t]*/, '');
    sections.push({ title: markdownToPlainText(heading.replace(/[ \t]+#+[ \t]*$/, '')), content });
  });

  const used = new Set<string>();
  return sections.map(({ title, content }) => {
    // `/` would create folders, a leading `.` would hide the file.
    const base = title.replace(/[\\/]/g, '-').replace(/^\.+/, '').trim() || UNTITLED_NOTE_TITLE;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    return { path: `${name}.md`, title, content: content.replace(/\n+$/, '\n') };
  });
}
