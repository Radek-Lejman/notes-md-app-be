import type { JSONContent } from '@tiptap/core';

/*
 * KEEP IN SYNC with notes-app-fe/src/shared/lib/editor/markdown/markdownEscape.ts
 * Both sides must escape identically, otherwise migrated notes differ from editor output.
 *
 * @tiptap/markdown writes text nodes verbatim, so "# not a heading" typed by the user would
 * come back as a heading after a save/load round trip. We escape text before serializing.
 */

// Characters that start inline syntax anywhere in a line.
const INLINE_SPECIAL = /[\\`*_[\]~]/g;
// `&` only when it would read as an HTML entity (`&nbsp;`, `&#123;`).
const ENTITY_LIKE = /&(?=#?[a-z0-9]+;)/gi;
// `<` only when it would read as an HTML tag or comment.
const HTML_LIKE = /<(?=[a-z/!?])/gi;
// Block markers that only matter at the start of a line: heading, quote, bullets, setext.
const LINE_START_BLOCK = /^(\s*)([#>+=-])/;
// Ordered list marker: `1.` or `1)` followed by whitespace or end of line.
const LINE_START_ORDERED = /^(\s*\d+)([.)])(?=\s|$)/;
// Any backslash-escaped ASCII punctuation.
const ESCAPED = /\\([!-/:-@[-`{-~])/g;

const TEXTBLOCKS = new Set(['paragraph', 'heading']);

export function escapeInline(text: string): string {
  return text.replace(INLINE_SPECIAL, '\\$&').replace(ENTITY_LIKE, '\\&').replace(HTML_LIKE, '\\<');
}

export function escapeLineStart(text: string): string {
  return text.replace(LINE_START_BLOCK, '$1\\$2').replace(LINE_START_ORDERED, '$1\\$2');
}

export function unescapeMarkdown(text: string): string {
  return text.replace(ESCAPED, '$1');
}

const isCode = (node: JSONContent) => node.marks?.some((mark) => mark.type === 'code') ?? false;

const sameMarks = (a: JSONContent, b: JSONContent) =>
  JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);

/** The parser splits text around escapes (`1`, `.`, ` x`); line-start checks need it whole. */
function mergeTextNodes(content: JSONContent[]): JSONContent[] {
  return content.reduce<JSONContent[]>((merged, node) => {
    const last = merged[merged.length - 1];
    if (last?.type === 'text' && node.type === 'text' && sameMarks(last, node)) {
      merged[merged.length - 1] = { ...last, text: `${last.text ?? ''}${node.text ?? ''}` };
    } else {
      merged.push(node);
    }
    return merged;
  }, []);
}

/** Returns a copy of the document with every plain text node escaped for markdown output. */
export function escapeMarkdownDoc(node: JSONContent): JSONContent {
  if (!node.content || node.type === 'codeBlock') return node;
  if (!TEXTBLOCKS.has(node.type ?? '')) {
    return { ...node, content: node.content.map(escapeMarkdownDoc) };
  }

  let atLineStart = true;
  const content = mergeTextNodes(node.content).map((child) => {
    if (child.type === 'hardBreak') {
      atLineStart = true;
      return child;
    }
    if (child.type !== 'text' || !child.text || isCode(child)) {
      atLineStart = false;
      return child;
    }

    const escaped = escapeInline(child.text);
    const text = atLineStart ? escapeLineStart(escaped) : escaped;
    atLineStart = false;
    return { ...child, text };
  });

  return { ...node, content };
}
