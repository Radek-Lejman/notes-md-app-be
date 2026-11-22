import { MetricComparison, RunComparison, VERDICT } from '../run/compareRuns';
import { metricDecimals } from './aggregate';

const signed = (x: number, digits: number) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;

function formatMetric(row: MetricComparison, width: number): string {
  const digits = metricDecimals(row.metric);
  const { mean, lo, hi } = row.diff;
  const values = `${row.base.toFixed(digits)} → ${row.current.toFixed(digits)}`;
  const diff = `${signed(mean, digits)} [${signed(lo, digits)}, ${signed(hi, digits)}]`;
  return `  ${row.metric.padEnd(width)}  ${values}  ${diff}  ${row.verdict}`;
}

/** What could explain a difference besides the change being tested. */
function formatWarnings(comparison: RunComparison): string[] {
  const warnings: string[] = [];
  if (!comparison.sameDataset) {
    warnings.push('dataset changed: only common case ids are compared, their labels may differ');
  }
  if (!comparison.sameIndex) {
    warnings.push('different index (vault edited or re-embedded): a case or two may move anyway');
  }
  const { onlyInBase, onlyInCurrent } = comparison;
  if (onlyInBase.length || onlyInCurrent.length) {
    warnings.push(
      `not compared: ${onlyInBase.length} only in base, ${onlyInCurrent.length} only in current`,
    );
  }
  return warnings.map((warning) => `  ! ${warning}`);
}

export function formatComparison(comparison: RunComparison, baseName: string): string {
  const changes = comparison.configChanges.map(
    ({ key, base, current }) => `${key} ${String(base)} → ${String(current)}`,
  );
  const width = Math.max(...comparison.metrics.map((row) => row.metric.length));
  const counts = Object.values(VERDICT).map(
    (verdict) => `${verdict} ${comparison.metrics.filter((row) => row.verdict === verdict).length}`,
  );

  return [
    `Compared with ${baseName} on ${comparison.common} common cases (paired bootstrap, 95% CI):`,
    `  config: ${changes.length ? changes.join(', ') : 'unchanged'}`,
    ...formatWarnings(comparison),
    ...comparison.metrics.map((row) => formatMetric(row, width)),
    `  ${counts.join(' · ')}`,
  ].join('\n');
}
