import { COUNT_METRICS } from '../report/aggregate';
import { Estimate, mean, pairedBootstrapDiff } from '../metrics/stats';
import { EvalConfig } from './evalConfig';
import { RunCase, RunRecord } from './runRecord';

export const VERDICT = {
  improvement: 'improvement',
  regression: 'regression',
  /** The 95% interval of the paired difference contains 0. */
  noise: 'noise',
} as const;
export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

/** Metrics where a smaller value is the better one. */

export interface MetricComparison {
  metric: string;
  base: number;
  current: number;
  /** current - base, paired over the cases both runs scored. */
  diff: Estimate;
  verdict: Verdict;
}

export interface RunComparison {
  /** Cases scored in both runs; only these are compared. */
  common: number;
  onlyInBase: string[];
  onlyInCurrent: string[];
  configChanges: { key: string; base: unknown; current: unknown }[];
  sameDataset: boolean;
  sameIndex: boolean;
  metrics: MetricComparison[];
}

function verdictOf(metric: string, diff: Estimate): Verdict {
  if (diff.lo <= 0 && diff.hi >= 0) return VERDICT.noise;
  const better = diff.lo > 0 !== COUNT_METRICS.has(metric);
  return better ? VERDICT.improvement : VERDICT.regression;
}

function compareMetric(metric: string, pairs: [RunCase, RunCase][]): MetricComparison | null {
  const values = pairs
    .map(([base, current]) => [base.metrics[metric], current.metrics[metric]] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] != null && pair[1] != null);
  if (values.length === 0) return null;

  const base = values.map(([b]) => b);
  const current = values.map(([, c]) => c);
  const diff = pairedBootstrapDiff(base, current);
  return {
    metric,
    base: mean(base),
    current: mean(current),
    diff,
    verdict: verdictOf(metric, diff),
  };
}

function configChanges(base: EvalConfig, current: EvalConfig) {
  return (Object.keys(base) as (keyof EvalConfig)[])
    .filter((key) => base[key] !== current[key])
    .map((key) => ({ key, base: base[key], current: current[key] }));
}

/**
 * Paired comparison on the same case ids: per-question difficulty cancels out, so a real change
 * shows up with far fewer cases than comparing two independent means would need.
 */
export function compareRuns(base: RunRecord, current: RunRecord): RunComparison {
  const currentById = new Map(current.cases.map((c) => [c.id, c]));
  const baseIds = new Set(base.cases.map((c) => c.id));
  const pairs = base.cases.flatMap((c): [RunCase, RunCase][] => {
    const other = currentById.get(c.id);
    return other ? [[c, other]] : [];
  });
  const metrics = Object.keys(base.cases[0]?.metrics ?? {});

  return {
    common: pairs.length,
    onlyInBase: base.cases.filter((c) => !currentById.has(c.id)).map((c) => c.id),
    onlyInCurrent: current.cases.filter((c) => !baseIds.has(c.id)).map((c) => c.id),
    configChanges: configChanges(base.config, current.config),
    sameDataset: base.datasetHash === current.datasetHash,
    sameIndex: base.indexFingerprint === current.indexFingerprint,
    metrics: metrics.flatMap((metric) => compareMetric(metric, pairs) ?? []),
  };
}
