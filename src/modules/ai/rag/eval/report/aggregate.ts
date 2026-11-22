import { QuestionType } from '../dataset/schema';
import { RetrievalScores } from '../metrics/retrieval';
import { bootstrapCI, Estimate } from '../metrics/stats';

/** Counted in tokens, not a 0..1 rate. */
export const CONTEXT_TOKENS_METRIC = 'contextTokens@5';
/** Search time per question (embedding, retrieval, rerank). Not deterministic, unlike the rest. */
export const LATENCY_METRIC = 'latencyMs';
/** Counts, not 0..1 rates: printed without decimals, and lower is better. */
export const COUNT_METRICS: ReadonlySet<string> = new Set([CONTEXT_TOKENS_METRIC, LATENCY_METRIC]);

export const metricDecimals = (metric: string) => (COUNT_METRICS.has(metric) ? 0 : 3);

export interface CaseResult {
  id: string;
  type: QuestionType;
  question: string;
  scores: RetrievalScores;
  latencyMs: number;
}

export interface MetricEstimate extends Estimate {
  metric: string;
}

export interface Aggregates {
  overall: MetricEstimate[];
  byType: Partial<Record<QuestionType, MetricEstimate[]>>;
}

/** One case's scores as named metrics; null = not applicable (no heading in its gold). */
export function metricValues({
  scores,
  latencyMs,
}: Pick<CaseResult, 'scores' | 'latencyMs'>): Record<string, number | null> {
  const atK = (name: string, values: Record<number, number>) =>
    Object.entries(values).map(([k, value]) => [`${name}@${k}`, value] as const);

  return Object.fromEntries([
    ...atK('hit', scores.hit),
    ...atK('recall', scores.recall),
    ['mrr', scores.mrr],
    ['ndcg@10', scores.ndcg10],
    ['sectionHit@5', scores.sectionHit5],
    ['contextPrecision@5', scores.contextPrecision5],
    [CONTEXT_TOKENS_METRIC, scores.contextTokens5],
    [LATENCY_METRIC, latencyMs],
  ]);
}

/** Mean + bootstrap CI of every metric; n differs per metric when some values are null. */
function estimate(results: CaseResult[]): MetricEstimate[] {
  const perCase = results.map(metricValues);
  const metrics = Object.keys(perCase[0] ?? {});
  return metrics.map((metric) => {
    const values = perCase.map((values) => values[metric]).filter((v): v is number => v !== null);
    return { metric, ...bootstrapCI(values) };
  });
}

export function aggregate(results: CaseResult[]): Aggregates {
  const types = [...new Set(results.map((result) => result.type))];
  return {
    overall: estimate(results),
    byType: Object.fromEntries(
      types.map((type) => [type, estimate(results.filter((result) => result.type === type))]),
    ),
  };
}
