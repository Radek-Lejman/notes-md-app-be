import { UnmappedGold } from '../dataset/goldMapping';
import { StaleCase } from '../dataset/staleness';
import { EvalConfig } from '../run/evalConfig';
import { Aggregates, CaseResult, MetricEstimate, metricDecimals } from './aggregate';

/** A case counts as missed when no gold note made it into the LLM-sized context (top 5). */
export const MISS_RANK = 5;
/** Per question type only the headline metrics; the full table is the overall one. */
const TYPE_METRICS = ['hit@5', 'recall@10', 'mrr'];

export interface ReportInput {
  config: EvalConfig;
  aggregates: Aggregates;
  results: CaseResult[];
  unmapped: UnmappedGold[];
  /** Cases left out of retrieval scoring because they have no gold. */
  unanswerable: number;
  /** Cases whose gold notes changed or vanished since their hashes were pinned. */
  stale: StaleCase[];
  /** --include-stale: stale cases were scored anyway. */
  staleIncluded: boolean;
}

function formatEstimate({ metric, mean, lo, hi }: MetricEstimate): string {
  const fixed = (x: number) => x.toFixed(metricDecimals(metric));
  return `${fixed(mean)} [${fixed(lo)}, ${fixed(hi)}]`;
}

function formatConfig(config: EvalConfig): string {
  return [
    `model ${config.embeddingModel} · chunk ${config.chunkSize}/${config.chunkOverlap}`,
    `minScore ${config.minScore} (semantic hits below it are cut) · topK ${config.topK}`,
    `hybrid ${config.hybrid}`,
    config.rerankModel
      ? `rerank ${config.rerankModel} over ${config.rerankCandidates}`
      : 'rerank off',
  ].join(' · ');
}

function formatOverall(overall: MetricEstimate[]): string[] {
  const width = Math.max(...overall.map((row) => row.metric.length));
  return overall.map((row) => `  ${row.metric.padEnd(width)}  ${formatEstimate(row)}  n=${row.n}`);
}

function formatByType(byType: Aggregates['byType']): string[] {
  return Object.entries(byType).map(([type, rows]) => {
    const picked = rows.filter((row) => TYPE_METRICS.includes(row.metric));
    const cells = picked.map((row) => `${row.metric} ${formatEstimate(row)}`);
    return `  ${type} (n=${rows[0].n}): ${cells.join(' · ')}`;
  });
}

function formatMissed(results: CaseResult[]): string[] {
  return results
    .filter(({ scores }) => scores.firstGoldRank === null || scores.firstGoldRank > MISS_RANK)
    .map(({ id, type, question, scores }) => {
      const rank = scores.firstGoldRank ?? 'not found';
      return `  ${id} [${type}] rank ${rank}: ${question}`;
    });
}

function formatStale(stale: StaleCase[], included: boolean): string[] {
  const how = included
    ? 'scored anyway (--include-stale)'
    : 'not scored; re-check, then `npm run rag:dataset -- pin --ids <ids>`';
  return [
    '',
    `Stale gold, ${how}: ${stale.length}`,
    ...stale.map(({ caseId, missing, changed }) => {
      const parts: string[] = [];
      if (changed.length) parts.push(`changed ${changed.join(', ')}`);
      if (missing.length) parts.push(`missing ${missing.join(', ')}`);
      return `  ${caseId}: ${parts.join('; ')}`;
    }),
  ];
}

/** Plain-text report: config, overall table with 95% CIs, per type, misses, stale and unmapped gold. */
export function formatReport(input: ReportInput): string {
  const missed = formatMissed(input.results);
  const lines = [
    `RAG retrieval eval: ${input.results.length} cases scored, ${input.unanswerable} unanswerable skipped`,
    formatConfig(input.config),
    '',
    'Overall (mean [95% CI]):',
    ...formatOverall(input.aggregates.overall),
    '',
    'By question type:',
    ...formatByType(input.aggregates.byType),
    '',
    `Missed (no gold note in top ${MISS_RANK}): ${missed.length}`,
    ...missed,
  ];
  if (input.stale.length) lines.push(...formatStale(input.stale, input.staleIncluded));
  if (input.unmapped.length) {
    lines.push('', `Unmapped gold paths (cases not scored): ${input.unmapped.length}`);
    lines.push(...input.unmapped.map(({ caseId, path }) => `  ${caseId}: ${path}`));
  }
  return lines.join('\n');
}
