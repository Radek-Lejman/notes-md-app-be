import { ConversionResult, tiptapToMarkdown, TiptapNode } from '../utils/tiptapToMarkdown';

export type BackfillTable = 'note' | 'noteVersion';

export interface BackfillRow {
  id: string;
  content: unknown;
}

/** The slice of a Prisma delegate the backfill needs (also implementable with raw SQL). */
export interface BackfillDelegate {
  findMany(args: {
    take: number;
    skip?: number;
    cursor?: { id: string };
    orderBy: { id: 'asc' };
    select: { id: true; content: true };
  }): Promise<BackfillRow[]>;
  update(args: { where: { id: string }; data: { contentMd: string } }): Promise<unknown>;
}

export type BackfillClient = Record<BackfillTable, BackfillDelegate>;

export interface BackfillReport {
  processed: number;
  failed: { table: BackfillTable; id: string }[];
  droppedMarks: Record<string, number>;
  unknownNodes: Record<string, number>;
}

export interface BackfillOptions {
  batchSize?: number;
  convert?: (doc: TiptapNode | null) => ConversionResult;
}

const TABLES: BackfillTable[] = ['note', 'noteVersion'];

const textDoc = (text: string): TiptapNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const isNode = (value: unknown): value is TiptapNode =>
  typeof value === 'object' && value !== null && typeof (value as TiptapNode).type === 'string';

/**
 * Normalizes what older versions stored in the JSON column: a Tiptap document, the same document
 * serialized to a JSON string, or plain text (written by scripts/sanitize-notes.ts).
 */
export function toTiptapDoc(content: unknown): TiptapNode | null {
  if (isNode(content)) return content;
  if (typeof content !== 'string' || content.trim() === '') return null;

  try {
    const parsed: unknown = JSON.parse(content);
    if (isNode(parsed)) return parsed;
  } catch {
    // not JSON: plain text
  }
  return textDoc(content);
}

const addCounts = (target: Record<string, number>, source: Record<string, number>) => {
  Object.entries(source).forEach(([key, count]) => {
    target[key] = (target[key] ?? 0) + count;
  });
};

/**
 * Fills `content_md` with the markdown of every note and note version. Idempotent: every run
 * recomputes all rows from the original JSON, so it is safe to run again right before the switch.
 */
export async function backfillContentMd(
  client: BackfillClient,
  { batchSize = 500, convert = tiptapToMarkdown }: BackfillOptions = {},
): Promise<BackfillReport> {
  const report: BackfillReport = { processed: 0, failed: [], droppedMarks: {}, unknownNodes: {} };

  for (const table of TABLES) {
    const delegate = client[table];
    let cursor: string | undefined;

    for (;;) {
      const rows = await delegate.findMany({
        take: batchSize,
        orderBy: { id: 'asc' },
        select: { id: true, content: true },
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });

      for (const row of rows) {
        try {
          const { markdown, report: rowReport } = convert(toTiptapDoc(row.content));
          await delegate.update({ where: { id: row.id }, data: { contentMd: markdown } });
          addCounts(report.droppedMarks, rowReport.droppedMarks);
          addCounts(report.unknownNodes, rowReport.unknownNodes);
          report.processed++;
        } catch {
          report.failed.push({ table, id: row.id });
        }
      }

      if (rows.length < batchSize) break;
      cursor = rows[rows.length - 1].id;
    }
  }

  return report;
}
