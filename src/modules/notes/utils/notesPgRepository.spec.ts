import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '@database/prisma';
import { NotesPgRepository } from './notesPgRepository';

const MIGRATIONS_DIR = join(__dirname, '../../../../prisma/migrations');

const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/** Expression of the most recent `CREATE INDEX <name> ... USING GIN (<expr>)` across migrations. */
function latestIndexExpression(indexName: string): string {
  const allSql = readdirSync(MIGRATIONS_DIR)
    .sort()
    .map((dir) => join(MIGRATIONS_DIR, dir, 'migration.sql'))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const pattern = new RegExp(
    `CREATE INDEX[^;]*?"?${indexName}"?\\s+ON\\s+"Note"\\s+USING\\s+GIN\\s*\\(([\\s\\S]*?)\\);`,
    'g',
  );
  const matches = [...allSql.matchAll(pattern)];
  if (matches.length === 0) throw new Error(`Index ${indexName} not found in migrations`);

  return normalize(matches[matches.length - 1][1]);
}

describe('NotesPgRepository', () => {
  const queryRaw = jest.fn();
  const repository = new NotesPgRepository({ $queryRaw: queryRaw } as unknown as PrismaService);

  const runSearch = async (userId: string, q: string) => {
    await repository.searchNotesDb(userId, q);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    return { sql: normalize(strings.join('$')), values };
  };

  beforeEach(() => queryRaw.mockReset().mockResolvedValue([]));

  it('returns the matching ids', async () => {
    queryRaw.mockResolvedValue([{ id: 'n1' }]);
    await expect(repository.searchNotesDb('user-1', 'docker')).resolves.toEqual([{ id: 'n1' }]);
  });

  it('scopes the search to the user', async () => {
    const { sql } = await runSearch('user-1', 'docker');
    expect(sql).toContain('"userId" =');
  });

  it('passes the user id and the query as bound parameters, never inlined', async () => {
    const q = `'; DROP TABLE "Note"; --`;
    const { sql, values } = await runSearch('user-1', q);

    expect(values).toEqual(expect.arrayContaining(['user-1', q]));
    expect(sql).not.toContain('user-1');
    expect(sql).not.toContain('DROP TABLE');
  });

  // Postgres only uses an expression index when the query repeats the exact same expression.
  it.each(['note_title_fts_idx', 'note_content_fts_idx'])(
    'repeats the exact expression of %s so the GIN index is used',
    async (indexName) => {
      const { sql } = await runSearch('user-1', 'docker');
      expect(sql).toContain(latestIndexExpression(indexName));
    },
  );
});
