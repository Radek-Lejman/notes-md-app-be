import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvalCase } from '../dataset/schema';
import { datasetHash, readRun, RunRecord, runFileName, toRunCase, writeRun } from './runRecord';

const record = (createdAt: string, label: string | null): RunRecord => ({
  createdAt,
  label,
  config: {
    embeddingModel: 'bge-m3',
    chunkSize: 1500,
    chunkOverlap: 200,
    minScore: 0.45,
    topK: 20,
    hybrid: true,
    rerankModel: null,
    rerankCandidates: null,
  },
  datasetHash: 'd',
  indexFingerprint: 'i',
  excluded: { stale: [], unmapped: [] },
  overall: [{ metric: 'sectionHit@5', mean: NaN, lo: NaN, hi: NaN, n: 0 }],
  cases: [{ id: 'q1', type: 'fact', question: 'q', firstGoldRank: 2, metrics: { mrr: 0.5 } }],
});

describe('toRunCase', () => {
  it('keeps the rank and flattens the scores into named metrics', () => {
    const scores = {
      firstGoldRank: 2,
      hit: { 1: 0 },
      recall: { 1: 0 },
      ndcg10: 0.6,
      mrr: 0.5,
      sectionHit5: null,
      contextPrecision5: 0.2,
      contextTokens5: 100,
    };

    const runCase = toRunCase({ id: 'q1', type: 'fact', question: 'q', scores, latencyMs: 12 });

    expect(runCase).toMatchObject({ id: 'q1', type: 'fact', question: 'q', firstGoldRank: 2 });
    expect(runCase.metrics).toMatchObject({
      'hit@1': 0,
      mrr: 0.5,
      'sectionHit@5': null,
      latencyMs: 12,
    });
  });
});

describe('datasetHash', () => {
  const evalCase = { id: 'q1', question: 'q' } as EvalCase;

  it('changes when any case changes', () => {
    expect(datasetHash([evalCase])).toBe(datasetHash([{ ...evalCase }]));
    expect(datasetHash([evalCase])).not.toBe(datasetHash([{ ...evalCase, question: 'q2' }]));
  });
});

describe('runFileName', () => {
  it('is a sortable time stamp plus the label', () => {
    expect(runFileName({ createdAt: '2026-11-08T14:03:12.345Z', label: 'baseline' })).toBe(
      '2026-11-08T14-03-12-345Z_baseline.json',
    );
    expect(runFileName({ createdAt: '2026-11-08T14:03:12.345Z', label: null })).toBe(
      '2026-11-08T14-03-12-345Z.json',
    );
  });

  it('rejects a label that is unsafe in a file name or ambiguous', () => {
    expect(() => runFileName({ createdAt: 'x', label: '../x' })).toThrow('Label');
    expect(() => runFileName({ createdAt: 'x', label: 'my_base' })).toThrow('Label');
  });
});

describe('writeRun / readRun', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'runs-'));
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('round-trips a run, storing NaN estimates as null', async () => {
    const file = await writeRun(join(dir, 'nested'), record('2026-11-08T10:00:00.000Z', null));

    expect(await readFile(file, 'utf8')).toContain('"mean": null');
    expect((await readRun(dir, file)).cases[0].id).toBe('q1');
  });

  it('reads a run saved before the reranker settings existed as one without a reranker', async () => {
    const old = record('2026-11-08T10:00:00.000Z', null);
    const config: Record<string, unknown> = { ...old.config };
    delete config.rerankModel;
    delete config.rerankCandidates;
    const file = join(dir, 'old.json');
    await writeFile(file, JSON.stringify({ ...old, config }));

    expect((await readRun(dir, file)).config).toMatchObject({
      rerankModel: null,
      rerankCandidates: null,
    });
  });

  it('finds the newest run with a label', async () => {
    await writeRun(dir, record('2026-11-08T10:00:00.000Z', 'baseline'));
    await writeRun(dir, record('2026-11-08T12:00:00.000Z', 'baseline'));
    await writeRun(dir, record('2026-11-08T13:00:00.000Z', 'other'));

    expect((await readRun(dir, 'baseline')).createdAt).toBe('2026-11-08T12:00:00.000Z');
    await expect(readRun(dir, 'missing')).rejects.toThrow('No run labelled "missing"');
  });
});
