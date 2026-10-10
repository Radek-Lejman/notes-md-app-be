import { TiptapNode } from './tiptapToMarkdown';

const BLOCK_NODES = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock']);

/** Flattens a Tiptap document into plain text (e.g. for search snippets or LLM context). */
export function tiptapToText(node?: TiptapNode | null): string {
  if (!node) return '';
  if (node.text) return node.text;
  if (node.type === 'hardBreak') return '\n'; // Shift+Enter line break inside a block

  const inner = (node.content ?? []).map(tiptapToText).join('');
  return BLOCK_NODES.has(node.type) ? `${inner}\n` : inner;
}
