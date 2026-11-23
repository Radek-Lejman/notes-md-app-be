import { RetrievalScores } from '../metrics/retrieval';
import { EvalConfig } from '../run/evalConfig';
import { aggregate, CaseResult } from './aggregate';
import { formatReport, ReportInput } from './formatReport';

const config: EvalConfig = {
  embeddingModel: 'bge-m3',
  chunkSize: 1500,
  chunkOverlap: 200,
  minScore: 0.45,
  topK: 20,
  hybrid: true,
  rerankModel: null,
  rerankCandidates: null,
};

const scores = (firstGoldRank: number | null): RetrievalScores => ({
  firstGoldRank,
  hit: { 5: Number(firstGoldRank !== null && firstGoldRank <= 5) },
  recall: { 10: Number(firstGoldRank !== null) },
  ndcg10: 0.5,
  mrr: firstGoldRank ? 1 / firstGoldRank : 0,
  sectionHit5: null,
  contextPrecision5: 0.2,
  contextTokens5: 812.4,
});

const results: CaseResult[] = [
  { id: 'q1', type: 'fact', question: 'Ile rdzeni?', scores: scores(1), latencyMs: 30 },
  { id: 'q2', type: 'paraphrase', question: 'Czemu wolniej?', scores: scores(7), latencyMs: 30 },
  { id: 'q3', type: 'paraphrase', question: 'Gdzie jechać?', scores: scores(null), latencyMs: 30 },
];

const input = (overrides: Partial<ReportInput> = {}): ReportInput => ({
  config,
  aggregates: aggregate(results),
  results,
  unmapped: [],
  unanswerable: 2,
  stale: [],
  staleIncluded: false,
  ...overrides,
});

describe('formatReport', () => {
  it('prints the config with the min score and the case counts', () => {
    const report = formatReport(input());

    expect(report).toContain('3 cases scored, 2 unanswerable (abstention only, below)');
    expect(report).toContain('minScore 0.45');
    expect(report).toContain('model bge-m3 · chunk 1500/200');
    expect(report).toContain('rerank off');
  });

  it('prints the reranker and its candidate count when there is one', () => {
    const report = formatReport(
      input({ config: { ...config, rerankModel: 'bge-reranker', rerankCandidates: 40 } }),
    );
    expect(report).toContain('rerank bge-reranker over 40');
  });

  it('prints rates with 3 decimals and the token count without', () => {
    const report = formatReport(input());

    expect(report).toMatch(/mrr +0\.\d{3} \[0\.\d{3}, \d\.\d{3}\] {2}n=3/);
    expect(report).toMatch(/contextTokens@5 +812 \[812, 812\] {2}n=3/);
    expect(report).toMatch(/latencyMs +30 \[30, 30\] {2}n=3/);
  });

  it('prints headline metrics per question type', () => {
    expect(formatReport(input())).toContain('paraphrase (n=2): hit@5 0.000 [0.000, 0.000]');
  });

  it('lists cases with no gold note in the top 5', () => {
    const report = formatReport(input());

    expect(report).toContain('Missed (no gold note in top 5): 2');
    expect(report).toContain('q2 [paraphrase] rank 7: Czemu wolniej?');
    expect(report).toContain('q3 [paraphrase] rank not found: Gdzie jechać?');
    expect(report).not.toContain('q1 [fact]');
  });

  it('lists unmapped gold paths only when there are some', () => {
    expect(formatReport(input())).not.toContain('Unmapped');
    expect(formatReport(input({ unmapped: [{ caseId: 'q9', path: 'gone.md' }] }))).toContain(
      'Unmapped gold paths (cases not scored): 1\n  q9: gone.md',
    );
  });

  it('lists stale cases with what changed and how they were treated', () => {
    const stale = [
      { caseId: 'q7', missing: [], changed: ['a.md', 'b.md'] },
      { caseId: 'q8', missing: ['gone.md'], changed: [] },
    ];

    expect(formatReport(input())).not.toContain('Stale gold');
    expect(formatReport(input({ stale }))).toContain(
      'Stale gold, not scored; re-check, then `npm run rag:dataset -- pin --ids <ids>`: 2\n' +
        '  q7: changed a.md, b.md\n  q8: missing gone.md',
    );
    expect(formatReport(input({ stale, staleIncluded: true }))).toContain(
      'Stale gold, scored anyway (--include-stale): 2',
    );
  });
});
