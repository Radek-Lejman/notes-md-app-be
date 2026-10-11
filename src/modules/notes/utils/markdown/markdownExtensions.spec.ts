import { Node } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import {
  createMarkdownExtensions,
  pageReferenceMarkdown,
  PAGE_REFERENCE_NODE,
  serializeMarkdown,
} from './markdownExtensions';

// Same node as the editor's PageReferenceNode (and tiptapToMarkdown), without the React view.
const PageReference = Node.create({
  name: PAGE_REFERENCE_NODE,
  group: 'block',
  atom: true,
  addAttributes: () => ({ noteId: { default: null }, title: { default: null } }),
  ...pageReferenceMarkdown,
});
const manager = new MarkdownManager({ extensions: [...createMarkdownExtensions(), PageReference] });

const ID = '123e4567-e89b-12d3-a456-426614174000';
const pageRef = (title: string, noteId = ID) => ({
  type: PAGE_REFERENCE_NODE,
  attrs: { noteId, title },
});
const roundTrip = (markdown: string) => serializeMarkdown(manager, manager.parse(markdown));

describe('page reference markdown', () => {
  it('parses a line that is only a link to a note as a page reference block', () => {
    expect(manager.parse(`[Docker](/notes/${ID})`).content).toEqual([pageRef('Docker')]);
  });

  it('unescapes the title', () => {
    expect(manager.parse(`[My \\] note](/notes/${ID})`).content).toEqual([pageRef('My ] note')]);
  });

  it('starts its own block in the middle of a paragraph', () => {
    expect(manager.parse(`Intro\n[Doc](/notes/${ID})\nafter`).content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
      pageRef('Doc'),
      { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ]);
  });

  it.each([
    ['an inline link to a note', `see [Doc](/notes/${ID}) inline`],
    ['a link to something other than a note', '[Docs](https://example.com)'],
    ['a link with an invalid note id', '[Doc](/notes/not-a-uuid)'],
  ])('keeps %s as a normal link', (_case, markdown) => {
    const [block] = manager.parse(markdown).content ?? [];
    expect(block.type).toBe('paragraph');
  });

  it('renders the title escaped and falls back to "Untitled"', () => {
    const doc = {
      type: 'doc',
      content: [pageRef('[draft] *wip*'), { type: PAGE_REFERENCE_NODE, attrs: { noteId: ID } }],
    };
    expect(serializeMarkdown(manager, doc)).toBe(
      `[\\[draft\\] \\*wip\\*](/notes/${ID})\n\n[Untitled](/notes/${ID})`,
    );
  });

  it.each([
    `[My \\] note](/notes/${ID})`,
    `Intro\n\n[Doc](/notes/${ID})\n\nafter`,
    `see [Doc](/notes/${ID}) inline`,
  ])('survives save -> load -> save unchanged: %j', (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe('markdown escapes', () => {
  it('parses escaped characters as literal text', () => {
    const [paragraph] = manager.parse('a \\*b\\*').content ?? [];
    expect(paragraph.content?.map((n) => n.text).join('')).toBe('a *b*');
    expect(paragraph.content?.some((n) => n.marks?.length)).toBe(false);
  });

  it('keeps them escaped on save', () => {
    expect(roundTrip('a \\*b\\* \\_c\\_')).toBe('a \\*b\\* \\_c\\_');
  });
});

describe('task lists', () => {
  it('parses and writes GFM task items', () => {
    const markdown = '- [ ] todo\n- [x] done';
    const [list] = manager.parse(markdown).content ?? [];

    expect(list.type).toBe('taskList');
    expect(list.content?.map((item) => item.attrs?.checked as boolean)).toEqual([false, true]);
    expect(roundTrip(markdown)).toBe(markdown);
  });
});
