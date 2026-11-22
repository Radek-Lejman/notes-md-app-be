import { RetrievalScores } from '../metrics/retrieval';
import { aggregate, CaseResult, metricValues } from './aggregate';

const scores = (overrides: Partial<RetrievalScores> = {}): RetrievalScores => ({
  firstGoldRank: 1,
  hit: { 1: 1, 3: 1, 5: 1, 10: 1 },
  recall: { 1: 1, 3: 1, 5: 1, 10: 1 },
  ndcg10: 1,
  mrr: 1,
  sectionHit5: null,
  contextPrecision5: 0.4,
  contextTokens5: 300,
  ...overrides,
});

const result = (id: string, type: CaseResult['type'], overrides = {}): CaseResult => ({
  id,
  type,
  question: `question ${id}`,
  scores: scores(overrides),
  latencyMs: 40,
});

describe('metricValues', () => {
  it('names every metric, with k in the name', () => {
    expect(metricValues({ scores: scores({ mrr: 0.5 }), latencyMs: 40 })).toEqual({
      'hit@1': 1,
      'hit@3': 1,
      'hit@5': 1,
      'hit@10': 1,
      'recall@1': 1,
      'recall@3': 1,
      'recall@5': 1,
      'recall@10': 1,
      mrr: 0.5,
      'ndcg@10': 1,
      'sectionHit@5': null,
      'contextPrecision@5': 0.4,
      'contextTokens@5': 300,
      latencyMs: 40,
    });
  });
});

describe('aggregate', () => {
  const results = [
    result('q1', 'fact', { mrr: 1, sectionHit5: 1 }),
    result('q2', 'fact', { mrr: 0 }),
    result('q3', 'multi_hop', { mrr: 0.5 }),
  ];

  it('averages each metric over all cases, skipping nulls in n', () => {
    const { overall } = aggregate(results);
    const byName = Object.fromEntries(overall.map((row) => [row.metric, row]));

    expect(byName.mrr).toMatchObject({ mean: 0.5, n: 3 });
    expect(byName['sectionHit@5']).toMatchObject({ mean: 1, n: 1 });
    expect(byName.mrr.lo).toBeLessThanOrEqual(byName.mrr.hi);
  });

  it('splits by question type', () => {
    const { byType } = aggregate(results);

    expect(Object.keys(byType)).toEqual(['fact', 'multi_hop']);
    expect(byType.fact!.find((row) => row.metric === 'mrr')).toMatchObject({ mean: 0.5, n: 2 });
  });

  it('is empty without results', () => {
    expect(aggregate([])).toEqual({ overall: [], byType: {} });
  });
});
