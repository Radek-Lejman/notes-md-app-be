import { compareRuns } from './compareRuns';
import { RunCase, RunRecord } from './runRecord';

const CASES = 40;

const runCase = (i: number, metrics: RunCase['metrics']): RunCase => ({
  id: `q${i}`,
  type: 'fact',
  question: 'q',
  firstGoldRank: 1,
  metrics,
});

const run = (cases: RunCase[], overrides: Partial<RunRecord> = {}): RunRecord => ({
  createdAt: '2026-11-08T10:00:00.000Z',
  label: null,
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
  overall: [],
  cases,
  ...overrides,
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('compareRuns', () => {
  const base = run(range(CASES).map((i) => runCase(i, { mrr: 0.5, 'contextTokens@5': 800 })));

  it('calls a consistent gain an improvement and fewer tokens an improvement too', () => {
    const current = run(range(CASES).map((i) => runCase(i, { mrr: 0.7, 'contextTokens@5': 600 })));
    const { metrics } = compareRuns(base, current);

    const mrr = metrics.find((m) => m.metric === 'mrr')!;
    expect(mrr.base).toBeCloseTo(0.5);
    expect(mrr.current).toBeCloseTo(0.7);
    expect(mrr.verdict).toBe('improvement');
    expect(metrics.find((m) => m.metric === 'contextTokens@5')?.verdict).toBe('improvement');
  });

  it('calls slower searches a regression', () => {
    const fast = run(range(CASES).map((i) => runCase(i, { latencyMs: 50 })));
    const slow = run(range(CASES).map((i) => runCase(i, { latencyMs: 900 })));
    expect(compareRuns(fast, slow).metrics[0].verdict).toBe('regression');
  });

  it('calls a consistent loss a regression', () => {
    const current = run(range(CASES).map((i) => runCase(i, { mrr: 0.3, 'contextTokens@5': 900 })));
    const verdicts = compareRuns(base, current).metrics.map((m) => m.verdict);

    expect(verdicts).toEqual(['regression', 'regression']);
  });

  it('calls a change of a single case noise', () => {
    const current = run(
      range(CASES).map((i) => runCase(i, { mrr: i === 0 ? 1 : 0.5, 'contextTokens@5': 800 })),
    );

    expect(compareRuns(base, current).metrics.map((m) => m.verdict)).toEqual(['noise', 'noise']);
  });

  it('pairs by case id and reports cases present in one run only', () => {
    const current = run([runCase(1, { mrr: 0.5 }), runCase(99, { mrr: 1 })]);
    const comparison = compareRuns(
      run([runCase(0, { mrr: 0 }), runCase(1, { mrr: 0.5 })]),
      current,
    );

    expect(comparison).toMatchObject({ common: 1, onlyInBase: ['q0'], onlyInCurrent: ['q99'] });
  });

  it('skips cases where a metric is not applicable and metrics with no pairs at all', () => {
    const withNulls = run([runCase(0, { mrr: 0.5, 'sectionHit@5': null })]);

    expect(compareRuns(withNulls, withNulls).metrics.map((m) => m.metric)).toEqual(['mrr']);
  });

  it('reports what else changed: config, dataset and index', () => {
    const current = run(base.cases, {
      config: { ...base.config, minScore: 0.3, hybrid: false },
      datasetHash: 'd2',
      indexFingerprint: 'i2',
    });

    expect(compareRuns(base, current)).toMatchObject({
      configChanges: [
        { key: 'minScore', base: 0.45, current: 0.3 },
        { key: 'hybrid', base: true, current: false },
      ],
      sameDataset: false,
      sameIndex: false,
    });
    expect(compareRuns(base, base)).toMatchObject({ configChanges: [], sameDataset: true });
  });

  it('compares nothing when the base run is empty', () => {
    expect(compareRuns(run([]), base)).toMatchObject({ common: 0, metrics: [] });
  });
});
