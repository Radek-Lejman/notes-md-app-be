import { abstentionTable, auroc, ConfidenceSample } from '../metrics/abstention';

/** Name of a confidence signal (`semantic`, `rerank`) and its per-question samples. */
export type ConfidenceSignals = Record<string, ConfidenceSample[]>;

const pct = (share: number) => `${(share * 100).toFixed(0)}%`;

function formatSignal(name: string, samples: ConfidenceSample[]): string[] {
  const rows = abstentionTable(samples).map(
    ({ keepAnswerable, threshold, rejectUnanswerable }) =>
      `    threshold ${threshold.toFixed(3)}: keeps ${pct(keepAnswerable)} answerable, ` +
      `rejects ${pct(rejectUnanswerable)} unanswerable`,
  );
  return [`  ${name}: AUROC ${auroc(samples).toFixed(3)}`, ...rows];
}

/**
 * Does the best score tell answerable from unanswerable questions? AUROC 0.5 = no,
 * 1 = perfectly; then what a "nothing relevant found" threshold would cost and catch.
 */
export function formatAbstention(signals: ConfidenceSignals): string[] {
  const entries = Object.entries(signals);
  if (!entries.length) return [];
  const [, first] = entries[0];
  const unanswerable = first.filter((s) => !s.answerable).length;
  return [
    '',
    `Abstention (best score, ${first.length - unanswerable} answerable vs ${unanswerable} unanswerable):`,
    ...entries.flatMap(([name, samples]) => formatSignal(name, samples)),
  ];
}
