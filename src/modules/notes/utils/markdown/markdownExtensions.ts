import {
  Extension,
  type JSONContent,
  type MarkdownRendererHelpers,
  type MarkdownToken,
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import HardBreak from '@tiptap/extension-hard-break';
import CodeBlock from '@tiptap/extension-code-block';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { MarkdownManager } from '@tiptap/markdown';
import { escapeInline, escapeMarkdownDoc, unescapeMarkdown } from './markdownEscape';

/*
 * KEEP IN SYNC with notes-app-fe/src/shared/lib/editor/markdown/markdownExtensions.ts
 *
 * Fixes on top of @tiptap/markdown so that save -> load is lossless:
 * - escaped characters (`\*`) are dropped by the parser -> MarkdownEscape parses them as text
 * - hard breaks are written as trailing double spaces, which editors strip -> `\` + newline
 * - a code block containing ``` is closed early -> fence longer than any backtick run inside
 * - the editor's trailing empty paragraph is written as `&nbsp;` -> trimmed on serialize
 *
 * Task lists are GFM (`- [ ] todo`, `- [x] done`).
 */

const EMPTY_PARAGRAPH = '&nbsp;';

export const PAGE_REFERENCE_NODE = 'pageReference';

export const MarkdownEscape = Extension.create({
  name: 'markdownEscape',
  markdownTokenName: 'escape',
  parseMarkdown: (token: MarkdownToken) => ({ type: 'text', text: String(token.text ?? '') }),
});

export const MarkdownHardBreak = HardBreak.extend({
  renderMarkdown: () => '\\\n',
});

export const MarkdownCodeBlock = CodeBlock.extend({
  renderMarkdown: (node: JSONContent, h: MarkdownRendererHelpers) => {
    const code: string = node.content ? h.renderChildren(node.content) : '';
    const runs: string[] = code.match(/`+/g) ?? [];
    const longestRun = Math.max(0, ...runs.map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longestRun + 1));
    const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
    return `${fence}${language}\n${code}\n${fence}`;
  },
});

/** Editor extensions every markdown-backed editor (and the backend converter) must share. */
export const createMarkdownExtensions = () => [
  StarterKit.configure({
    underline: false,
    hardBreak: false,
    codeBlock: false,
    // Clicking a link places the caret; links open from the link menu or with Mod+click.
    link: { openOnClick: false, defaultProtocol: 'https' },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  MarkdownHardBreak,
  MarkdownCodeBlock,
  MarkdownEscape,
];

// A line that is nothing but a link to a note: `[Title](/notes/<uuid>)`.
const PAGE_REFERENCE_LINE = /^\[((?:\\.|[^\\\]\n])*)\]\(\/notes\/([0-9a-f-]{36})\)[ \t]*(?:\n|$)/i;
// Same line anywhere in the source; lets such a line start its own block.
const PAGE_REFERENCE_START = /^\[(?:\\.|[^\\\]\n])*\]\(\/notes\/[0-9a-f-]{36}\)[ \t]*$/im;

/** Markdown spec for the page reference block, spread into the Tiptap node definition. */
export const pageReferenceMarkdown = {
  renderMarkdown: (node: JSONContent) => {
    const title = typeof node.attrs?.title === 'string' && node.attrs.title ? node.attrs.title : '';
    const noteId = typeof node.attrs?.noteId === 'string' ? node.attrs.noteId : '';
    return `[${escapeInline(title || 'Untitled')}](/notes/${noteId})`;
  },
  markdownTokenizer: {
    name: PAGE_REFERENCE_NODE,
    level: 'block' as const,
    start: (src: string) => src.search(PAGE_REFERENCE_START),
    tokenize: (src: string) => {
      const match = PAGE_REFERENCE_LINE.exec(src);
      if (!match) return undefined;
      return {
        type: PAGE_REFERENCE_NODE,
        raw: match[0],
        title: unescapeMarkdown(match[1]),
        noteId: match[2],
      };
    },
  },
  parseMarkdown: (token: MarkdownToken) => ({
    type: PAGE_REFERENCE_NODE,
    attrs: { noteId: String(token.noteId), title: String(token.title) },
  }),
};

/** Serializes a Tiptap document to markdown with escaping and without trailing empty lines. */
export function serializeMarkdown(manager: MarkdownManager, doc: JSONContent): string {
  let markdown = manager.serialize(escapeMarkdownDoc(doc));

  while (markdown === EMPTY_PARAGRAPH || markdown.endsWith(`\n\n${EMPTY_PARAGRAPH}`)) {
    markdown = markdown.slice(0, Math.max(0, markdown.length - EMPTY_PARAGRAPH.length - 2));
  }
  return markdown;
}
