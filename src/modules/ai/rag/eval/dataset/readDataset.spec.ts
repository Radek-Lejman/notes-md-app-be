import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDataset } from './readDataset';

const line = (id: string) =>
  JSON.stringify({
    id,
    question: `question ${id}`,
    type: 'fact',
    gold: [{ note: 'a.md' }],
    referenceAnswer: '',
    keyFacts: [],
    origin: 'seed',
    reviewed: false,
    createdAt: '2026-11-08',
  });

describe('readDataset', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dataset-'));
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads a single file', async () => {
    const file = join(dir, 'golden.jsonl');
    await writeFile(file, `${line('q1')}\n${line('q2')}\n`);

    expect((await readDataset(file)).map((c) => c.id)).toEqual(['q1', 'q2']);
  });

  it('reads every .jsonl file of a folder in name order', async () => {
    await writeFile(join(dir, 'golden-300.jsonl'), line('syn-1'));
    await writeFile(join(dir, 'golden.jsonl'), line('seed-1'));
    await writeFile(join(dir, 'notes.md'), 'not a dataset');

    expect((await readDataset(dir)).map((c) => c.id)).toEqual(['syn-1', 'seed-1']);
  });

  it('rejects ids repeated across files', async () => {
    await writeFile(join(dir, 'a.jsonl'), line('q1'));
    await writeFile(join(dir, 'b.jsonl'), `${line('q1')}\n${line('q2')}`);

    await expect(readDataset(dir)).rejects.toThrow('Duplicate case ids');
    await expect(readDataset(dir)).rejects.toThrow(': q1');
  });

  it('rejects an empty dataset and a missing path', async () => {
    await expect(readDataset(dir)).rejects.toThrow('No eval cases');
    await expect(readDataset(join(dir, 'missing.jsonl'))).rejects.toThrow('ENOENT');
  });
});
