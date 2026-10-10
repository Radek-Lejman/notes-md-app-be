import { TiptapNode } from '../utils/tiptapToMarkdown';

/** Tiny builders for Tiptap JSON documents used across markdown-migration specs. */

type MarkInput = string | { type: string; attrs?: Record<string, unknown> };

export const text = (value: string, ...marks: MarkInput[]): TiptapNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 && {
    marks: marks.map((mark) => (typeof mark === 'string' ? { type: mark } : mark)),
  }),
});

export const link = (href: string) => ({ type: 'link', attrs: { href } });

export const doc = (...content: TiptapNode[]): TiptapNode => ({ type: 'doc', content });

export const p = (...content: TiptapNode[]): TiptapNode => ({
  type: 'paragraph',
  ...(content.length > 0 && { content }),
});

export const h = (level: number, ...content: TiptapNode[]): TiptapNode => ({
  type: 'heading',
  attrs: { level },
  content,
});

export const ul = (...items: TiptapNode[]): TiptapNode => ({ type: 'bulletList', content: items });

export const ol = (start: number, ...items: TiptapNode[]): TiptapNode => ({
  type: 'orderedList',
  attrs: { start },
  content: items,
});

export const li = (...content: TiptapNode[]): TiptapNode => ({ type: 'listItem', content });

export const quote = (...content: TiptapNode[]): TiptapNode => ({ type: 'blockquote', content });

export const codeBlock = (language: string | null, code: string): TiptapNode => ({
  type: 'codeBlock',
  attrs: { language },
  content: [text(code)],
});

export const hr = (): TiptapNode => ({ type: 'horizontalRule' });

export const br = (): TiptapNode => ({ type: 'hardBreak' });

export const pageRef = (noteId: string, title: string | null): TiptapNode => ({
  type: 'pageReference',
  attrs: { noteId, title },
});
