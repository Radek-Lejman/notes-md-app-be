import { Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma';
import { RagRepository, toVectorLiteral, utcTimestamp } from './rag.repository';
import { NoteToIndex } from './rag.types';

describe('toVectorLiteral', () => {
  it('formats numbers as a pgvector literal', () => {
    expect(toVectorLiteral([0.5, -1, 2e-3])).toBe('[0.5,-1,0.002]');
  });

  it.each([[[]], [[1, NaN]], [[Infinity]]])('rejects invalid vectors %j', (vector) => {
    expect(() => toVectorLiteral(vector)).toThrow('Invalid embedding vector');
  });
});

describe('utcTimestamp', () => {
  it('binds the date as an ISO string converted to UTC in SQL', () => {
    const sql = utcTimestamp(new Date('2026-10-11T12:34:56.789Z'));
    expect(sql.sql).toBe(`(?::timestamptz AT TIME ZONE 'UTC')`);
    expect(sql.values).toEqual(['2026-10-11T12:34:56.789Z']);
  });
});

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** A tagged-template call to $queryRaw/$executeRaw as one Prisma.Sql (nested fragments inlined). */
const asSql = (call: unknown[]) => {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  const sql = Prisma.sql(strings, ...(values as Prisma.Sql[]));
  return { text: normalize(sql.sql), values: sql.values };
};

describe('RagRepository', () => {
  const queryRaw = jest.fn<Promise<unknown>, unknown[]>();
  const executeRaw = jest.fn<unknown, unknown[]>();
  const transaction = jest.fn();
  const repository = new RagRepository({
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction: transaction,
  } as unknown as PrismaService);

  const note: NoteToIndex = {
    id: 'n1',
    userId: 'user-1',
    title: 'Ops',
    content: '# Deploy',
    updatedAt: new Date('2026-01-01T10:00:00.000Z'),
  };

  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([]);
    // Each $executeRaw returns a lazy PrismaPromise; the test only needs to identify it.
    executeRaw.mockReset().mockImplementation((strings: TemplateStringsArray) => ({
      statement: normalize(strings.join('?')),
    }));
    transaction.mockReset().mockResolvedValue([]);
  });

  describe('findNotesToIndex', () => {
    it('selects stale notes edited before the debounce point, skipping notes waiting to retry', async () => {
      const rows = [{ ...note }];
      queryRaw.mockResolvedValue(rows);
      const editedBefore = new Date('2026-01-02T00:00:00.000Z');

      await expect(repository.findNotesToIndex(20, editedBefore, ['n9'])).resolves.toBe(rows);

      const { text, values } = asSql(queryRaw.mock.calls[0]);
      expect(text).toContain('("ragIndexedAt" IS NULL OR "ragIndexedAt" < "updatedAt")');
      expect(text).toContain('NOT ("id" = ANY(?::text[]))');
      expect(text).toContain('ORDER BY "updatedAt" ASC LIMIT ?');
      expect(values).toEqual(['2026-01-02T00:00:00.000Z', ['n9'], 20]);
    });

    it('excludes nothing by default', async () => {
      await repository.findNotesToIndex(5, new Date());
      expect(asSql(queryRaw.mock.calls[0]).values[1]).toEqual([]);
    });
  });

  describe('replaceChunks', () => {
    const chunks = [
      { headingPath: 'Ops > Deploy', content: '# Deploy', embedding: [0.1, 0.2] },
      { headingPath: 'Ops > Backup', content: '# Backup', embedding: [0.3, 0.4] },
    ];

    it('deletes old chunks, inserts new ones and marks the indexed version in one transaction', async () => {
      await repository.replaceChunks(note, 'bge-m3', chunks);

      const [statements] = transaction.mock.calls[0] as [{ statement: string }[]];
      expect(statements.map((s) => s.statement.split(' ')[0])).toEqual([
        'DELETE',
        'INSERT',
        'INSERT',
        'UPDATE',
      ]);

      const insertValues = executeRaw.mock.calls
        .map((call: unknown[]) => asSql(call))
        .filter(({ text }) => text.startsWith('INSERT'))
        .map(({ values }) => values);
      expect(insertValues).toEqual([
        ['n1', 'user-1', 0, 'Ops > Deploy', '# Deploy', 'bge-m3', '[0.1,0.2]'],
        ['n1', 'user-1', 1, 'Ops > Backup', '# Backup', 'bge-m3', '[0.3,0.4]'],
      ]);
    });

    it('marks the note indexed only if it was not edited meanwhile', async () => {
      await repository.replaceChunks(note, 'bge-m3', []);

      const update = executeRaw.mock.calls
        .map((call: unknown[]) => asSql(call))
        .find(({ text }) => text.startsWith('UPDATE'));
      expect(update?.text).toContain('SET "ragIndexedAt" = "updatedAt"');
      expect(update?.text).toContain(`"updatedAt" = (?::timestamptz AT TIME ZONE 'UTC')`);
      expect(update?.values).toEqual(['n1', '2026-01-01T10:00:00.000Z']);
    });

    it('rejects an invalid embedding before touching the database', async () => {
      await expect(
        repository.replaceChunks(note, 'bge-m3', [{ ...chunks[0], embedding: [NaN] }]),
      ).rejects.toThrow('Invalid embedding vector');
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  it('invalidateOtherModels resets notes embedded with another model', async () => {
    executeRaw.mockReturnValue(Promise.resolve(4));

    await expect(repository.invalidateOtherModels('bge-m3')).resolves.toBe(4);
    const { text, values } = asSql(executeRaw.mock.calls[0]);
    expect(text).toContain('SET "ragIndexedAt" = NULL');
    expect(text).toContain('"model" <> ?');
    expect(values).toEqual(['bge-m3']);
  });

  describe('search', () => {
    it("searches only the user's chunks of the current model and vector size", async () => {
      const hits = [{ noteId: 'n1', title: 'Ops', headingPath: 'Ops', content: 'c', score: 0.9 }];
      queryRaw.mockResolvedValue(hits);

      await expect(repository.search('user-1', 'bge-m3', [0.1, 0.2], 6)).resolves.toBe(hits);

      const { text, values } = asSql(queryRaw.mock.calls[0]);
      expect(text).toContain('n."userId" = ?');
      expect(text).toContain('WHERE c."userId" = ?');
      expect(text).toContain('c."model" = ?');
      expect(text).toContain('vector_dims(c."embedding") = ?');
      expect(values).toEqual(['[0.1,0.2]', 'user-1', 'user-1', 'bge-m3', 2, '[0.1,0.2]', 6]);
    });

    it('never inlines the user id into the SQL text', async () => {
      const userId = `x' OR '1'='1`;
      await repository.search(userId, 'bge-m3', [1], 1);
      expect(asSql(queryRaw.mock.calls[0]).text).not.toContain(userId);
    });
  });

  it("stats counts only the user's notes and chunks, as numbers", async () => {
    queryRaw.mockResolvedValue([{ totalNotes: 5n, indexedNotes: 3n, chunks: 12n }]);

    await expect(repository.stats('user-1', 'bge-m3')).resolves.toEqual({
      totalNotes: 5,
      indexedNotes: 3,
      chunks: 12,
    });

    const [sql] = queryRaw.mock.calls[0] as [Prisma.Sql];
    expect(normalize(sql.sql)).toContain('"ragIndexedAt" >= "updatedAt"');
    expect(sql.values).toEqual(['user-1', 'user-1', 'user-1', 'bge-m3']);
  });
});
