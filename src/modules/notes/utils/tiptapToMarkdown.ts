import { getSchema, Node } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import {
  createMarkdownExtensions,
  pageReferenceMarkdown,
  PAGE_REFERENCE_NODE,
  serializeMarkdown,
} from './markdown/markdownExtensions';

/** Legacy note content: the Tiptap/ProseMirror JSON document the editor used to store. */
export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export interface ConversionReport {
  /** Marks markdown cannot express (underline, text style…): text is kept, formatting is lost. */
  droppedMarks: Record<string, number>;
  /** Node types the editor no longer knows: their children are kept, the wrapper is lost. */
  unknownNodes: Record<string, number>;
}

export interface ConversionResult {
  markdown: string;
  report: ConversionReport;
}

// Same schema and markdown spec as the editor's PageReferenceNode, without the React node view.
const PageReference = Node.create({
  name: PAGE_REFERENCE_NODE,
  group: 'block',
  atom: true,
  addAttributes: () => ({ noteId: { default: null }, title: { default: null } }),
  ...pageReferenceMarkdown,
});

// The exact extension set of the editor (notes-app-fe RichEditorRoot), so the output matches it.
const extensions = [...createMarkdownExtensions(), PageReference];
const schema = getSchema(extensions);
const manager = new MarkdownManager({ extensions });

const increment = (counter: Record<string, number>, key: string) => {
  counter[key] = (counter[key] ?? 0) + 1;
};

/** Drops marks and unwraps nodes the schema does not know, recording what was lost. */
function sanitize(node: TiptapNode, report: ConversionReport): TiptapNode[] {
  const children = () => (node.content ?? []).flatMap((child) => sanitize(child, report));

  if (!schema.nodes[node.type]) {
    increment(report.unknownNodes, node.type);
    return children();
  }

  const marks = (node.marks ?? []).filter((mark) => {
    if (schema.marks[mark.type]) return true;
    increment(report.droppedMarks, mark.type);
    return false;
  });

  const clean: TiptapNode = { type: node.type };
  if (node.attrs) clean.attrs = node.attrs;
  if (node.text !== undefined) clean.text = node.text;
  if (marks.length > 0) clean.marks = marks;
  if (node.content) clean.content = children();
  return [clean];
}

/** Converts a stored Tiptap document to the markdown the editor would produce for it. */
export function tiptapToMarkdown(doc?: TiptapNode | null): ConversionResult {
  const report: ConversionReport = { droppedMarks: {}, unknownNodes: {} };
  if (!doc) return { markdown: '', report };

  const [clean] = sanitize(doc, report);
  const markdown = clean ? serializeMarkdown(manager, clean) : '';
  return { markdown, report };
}
