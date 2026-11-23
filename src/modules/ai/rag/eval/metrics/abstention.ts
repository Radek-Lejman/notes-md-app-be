/**
 * Can a score threshold tell "the notes answer this" from "they don't"? Each case contributes
 * its best retrieval score (its confidence); unanswerable cases should score lower.
 */

export interface ConfidenceSample {
  answerable: boolean;
  /** Best score the search returned for the question; 0 when it returned nothing. */
  score: number;
}

export interface AbstentionRow {
  /** Share of answerable questions that stay above the threshold. */
  keepAnswerable: number;
  threshold: number;
  /** Share of unanswerable questions below the threshold, i.e. correctly met with "nothing found". */
  rejectUnanswerable: number;
}

/** Answerable questions kept per row: dropping more than 1 in 10 good questions is not an option. */
export const KEEP_RATES = [0.99, 0.95, 0.9] as const;

const split = (samples: ConfidenceSample[]) => ({
  answerable: samples.filter((s) => s.answerable).map((s) => s.score),
  unanswerable: samples.filter((s) => !s.answerable).map((s) => s.score),
});

/**
 * Probability that a random answerable question scores above a random unanswerable one
 * (ties count half): 0.5 = the score says nothing, 1 = a perfect threshold exists.
 */
export function auroc(samples: ConfidenceSample[]): number {
  const { answerable, unanswerable } = split(samples);
  if (!answerable.length || !unanswerable.length) return NaN;
  let wins = 0;
  for (const a of answerable) for (const u of unanswerable) wins += pairWin(a, u);
  return wins / (answerable.length * unanswerable.length);
}

function pairWin(answerable: number, unanswerable: number): number {
  if (answerable === unanswerable) return 0.5;
  return answerable > unanswerable ? 1 : 0;
}

/**
 * For each keep rate: the highest threshold that keeps that share of answerable questions,
 * and how many unanswerable ones it would turn away.
 */
export function abstentionTable(samples: ConfidenceSample[]): AbstentionRow[] {
  const { answerable, unanswerable } = split(samples);
  if (!answerable.length || !unanswerable.length) return [];
  const sorted = [...answerable].sort((a, b) => a - b);
  return KEEP_RATES.map((keepAnswerable) => {
    // Rounded first: (1 - 0.9) * 100 is 9.999…, which would floor to the wrong index.
    const dropped = Math.floor(Number(((1 - keepAnswerable) * sorted.length).toFixed(6)));
    const threshold = sorted[dropped];
    const rejected = unanswerable.filter((score) => score < threshold).length;
    return { keepAnswerable, threshold, rejectUnanswerable: rejected / unanswerable.length };
  });
}
