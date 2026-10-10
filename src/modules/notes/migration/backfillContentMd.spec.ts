import { backfillContentMd, toTiptapDoc } from './backfillContentMd';
import { ConversionResult } from '../utils/tiptapToMarkdown';
import { doc, p, text } from '../testing/tiptap.builders';

type Row = { id: string; content: unknown; contentMd?: string | null };
type FindManyArgs = { take: number; skip?: number; cursor?: { id: string }; orderBy?: unknown };
type UpdateArgs = { where: { id: string }; data: { contentMd: string } };

/** In-memory stand-in for a Prisma delegate that honours cursor pagination. */
function fakeTable(rows: Row[]) {
  const byId = () => [...rows].sort((a, b) => a.id.localeCompare(b.id));

  const findMany = jest.fn(({ take, skip = 0, cursor }: FindManyArgs) => {
    const sorted = byId();
    const start = cursor ? sorted.findIndex((row) => row.id === cursor.id) : 0;
    return Promise.resolve(
      sorted.slice(start + skip, start + skip + take).map(({ id, content }) => ({ id, content })),
    );
  });

  const update = jest.fn(({ where, data }: UpdateArgs) => {
    const row = rows.find((r) => r.id === where.id)!;
    Object.assign(row, data);
    return Promise.resolve(row);
  });

  return { rows, findMany, update };
}

const ids = (count: number, prefix = 'n') =>
  Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`);

const noteRows = (count: number, prefix = 'n'): Row[] =>
  ids(count, prefix).map((id) => ({ id, content: doc(p(text(id))) }));

const fakePrisma = (notes: Row[], versions: Row[] = []) => {
  const note = fakeTable(notes);
  const noteVersion = fakeTable(versions);
  const client = { note, noteVersion } as unknown as Parameters<typeof backfillContentMd>[0];
  return { client, note, noteVersion };
};

const result = (markdown: string, report: Partial<ConversionResult['report']> = {}) => ({
  markdown,
  report: { droppedMarks: {}, unknownNodes: {}, ...report },
});

/** Converter stub: markdown is derived from the row's only text node. */
const stubConvert = jest.fn((json: unknown) => {
  const id = (json as { content: { content: { text: string }[] }[] }).content[0].content[0].text;
  return result(`md:${id}`);
});

describe('backfillContentMd', () => {
  beforeEach(() => stubConvert.mockClear());

  it('does nothing for an empty database', async () => {
    const { client, note } = fakePrisma([]);

    const report = await backfillContentMd(client, { convert: stubConvert });

    expect(note.update).not.toHaveBeenCalled();
    expect(report).toEqual({ processed: 0, failed: [], droppedMarks: {}, unknownNodes: {} });
  });

  it('pages through every row in batches no larger than batchSize', async () => {
    const { client, note } = fakePrisma(noteRows(1201));

    const report = await backfillContentMd(client, { batchSize: 500, convert: stubConvert });

    expect(report.processed).toBe(1201);
    expect(note.findMany.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(note.findMany.mock.calls.every(([args]) => args.take <= 500)).toBe(true);
    expect(note.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { id: 'asc' } }));
    expect(note.update).toHaveBeenCalledTimes(1201);
    expect(note.rows.every((row) => row.contentMd === `md:${row.id}`)).toBe(true);
  });

  it('backfills both notes and note versions', async () => {
    const { client, note, noteVersion } = fakePrisma(noteRows(2), noteRows(3, 'v'));

    const report = await backfillContentMd(client, { convert: stubConvert });

    expect(report.processed).toBe(5);
    expect(note.rows.map((row) => row.contentMd)).toEqual(['md:n0000', 'md:n0001']);
    expect(noteVersion.rows.map((row) => row.contentMd)).toEqual([
      'md:v0000',
      'md:v0001',
      'md:v0002',
    ]);
  });

  it('uses the real tiptapToMarkdown converter by default', async () => {
    const { client, note } = fakePrisma([{ id: 'n1', content: doc(p(text('Hello', 'bold'))) }]);

    await backfillContentMd(client);

    expect(note.rows[0].contentMd).toBe('**Hello**');
  });

  it('is idempotent: a second run recomputes the same markdown', async () => {
    const { client, note } = fakePrisma(noteRows(3));

    const first = await backfillContentMd(client, { convert: stubConvert });
    const afterFirst = note.rows.map((row) => row.contentMd);
    const second = await backfillContentMd(client, { convert: stubConvert });

    expect(second).toEqual(first);
    expect(note.rows.map((row) => row.contentMd)).toEqual(afterFirst);
  });

  it('sums conversion reports across all rows and tables', async () => {
    const { client } = fakePrisma(noteRows(2), noteRows(1, 'v'));
    const convert = jest
      .fn()
      .mockReturnValueOnce(result('a', { droppedMarks: { underline: 1 } }))
      .mockReturnValueOnce(result('b', { droppedMarks: { underline: 2, textStyle: 1 } }))
      .mockReturnValueOnce(result('c', { unknownNodes: { callout: 1 } }));

    const report = await backfillContentMd(client, { convert });

    expect(report.droppedMarks).toEqual({ underline: 3, textStyle: 1 });
    expect(report.unknownNodes).toEqual({ callout: 1 });
  });

  it('records rows that fail to convert and keeps going', async () => {
    const { client, note } = fakePrisma(noteRows(3));
    const convert = jest.fn((json: unknown) => {
      const md = stubConvert(json).markdown;
      if (md === 'md:n0001') throw new Error('broken document');
      return result(md);
    });

    const report = await backfillContentMd(client, { convert });

    expect(report.processed).toBe(2);
    expect(report.failed).toEqual([{ table: 'note', id: 'n0001' }]);
    expect(note.rows.map((row) => row.contentMd)).toEqual(['md:n0000', undefined, 'md:n0002']);
  });
});

describe('toTiptapDoc', () => {
  const stored = doc(p(text('Hello')));

  it('passes a stored Tiptap document through', () => {
    expect(toTiptapDoc(stored)).toBe(stored);
  });

  it('parses a document stored as a JSON string', () => {
    expect(toTiptapDoc(JSON.stringify(stored))).toEqual(stored);
  });

  it.each(['plain legacy text', '{"not": "a document"}', '42'])(
    'wraps the string %j in a paragraph',
    (value) => {
      expect(toTiptapDoc(value)).toEqual(doc(p(text(value))));
    },
  );

  it.each([null, undefined, '', '   ', 42, { foo: 'bar' }])('returns null for %j', (value) => {
    expect(toTiptapDoc(value)).toBeNull();
  });
});
