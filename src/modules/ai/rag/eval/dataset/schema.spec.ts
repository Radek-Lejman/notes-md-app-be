import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvalCase, GoldRef, readJsonl, writeJsonl } from './schema';

const validCase = {
  id: 'q1',
  question: 'Kiedy zaczął się projekt?',
  type: 'temporal',
  gold: [{ note: 'Projects/a.md' }],
  referenceAnswer: 'W marcu.',
  keyFacts: ['marzec'],
  origin: 'seed',
  reviewed: true,
  createdAt: '2026-11-03',
};

describe('GoldRef', () => {
  it('defaults grade to primary', () => {
    expect(GoldRef.parse({ note: 'a.md' }).grade).toBe(2);
  });
});

describe('EvalCase', () => {
  it('requires gold for every type but unanswerable', () => {
    expect(EvalCase.safeParse({ ...validCase, gold: [] }).success).toBe(false);
    expect(EvalCase.safeParse({ ...validCase, type: 'unanswerable', gold: [] }).success).toBe(true);
  });
});

describe('readJsonl', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rag-eval-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (lines: string[]) => {
    const file = join(dir, 'golden.jsonl');
    await writeFile(file, lines.join('\n'));
    return file;
  };

  it('parses rows, skipping blank lines and // comments, and applies defaults', async () => {
    const file = await write(['// seed set', JSON.stringify(validCase), '', '  ']);
    const [row, ...rest] = await readJsonl(file, EvalCase);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ id: 'q1', mustNotClaim: [], tags: [], goldHashes: {} });
    expect(row.gold[0].grade).toBe(2);
  });

  it('returns [] for a missing file', async () => {
    await expect(readJsonl(join(dir, 'missing.jsonl'), EvalCase)).resolves.toEqual([]);
  });

  it('reports the file and line of an invalid row', async () => {
    const file = await write(['// header', JSON.stringify({ ...validCase, type: 'nope' })]);
    await expect(readJsonl(file, EvalCase)).rejects.toThrow(`${file}:2:`);
  });

  it('round-trips rows through writeJsonl, one per line', async () => {
    const file = join(dir, 'out.jsonl');
    const rows = await readJsonl(await write([JSON.stringify(validCase)]), EvalCase);
    await writeJsonl(file, [...rows, ...rows.map((row) => ({ ...row, id: 'q2' }))]);

    expect((await readJsonl(file, EvalCase)).map((row) => row.id)).toEqual(['q1', 'q2']);
  });
});
