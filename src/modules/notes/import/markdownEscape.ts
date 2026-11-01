/*
 * KEEP IN SYNC with escapeInline in notes-app-fe/src/shared/lib/editor/markdown/markdownEscape.ts.
 * Used for link text the import writes itself (note titles, wiki-link aliases), so it reads
 * back as plain text in the editor.
 */

// Characters that start inline syntax anywhere in a line.
const INLINE_SPECIAL = /[\\`*_[\]~]/g;
// `&` only when it would read as an HTML entity (`&nbsp;`, `&#123;`).
const ENTITY_LIKE = /&(?=#?[a-z0-9]+;)/gi;
// `<` only when it would read as an HTML tag or comment.
const HTML_LIKE = /<(?=[a-z/!?])/gi;

export function escapeInline(text: string): string {
  return text.replace(INLINE_SPECIAL, '\\$&').replace(ENTITY_LIKE, '\\&').replace(HTML_LIKE, '\\<');
}
