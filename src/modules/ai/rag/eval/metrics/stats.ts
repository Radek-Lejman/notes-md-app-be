/**
 * With ~100 cases a 2-point difference is usually noise. Every aggregate is
 * reported with a bootstrap CI, and comparisons use a *paired* bootstrap over
 * the same case ids. Seeded RNG -> identical CIs on re-run.
 */

/** Enough resamples for stable 95% bounds at ~100 cases while staying instant. */
const BOOTSTRAP_ITERATIONS = 2000;
/** Fixed so a re-run of the same data gives the same CI. */
const BOOTSTRAP_SEED = 42;
/** Two-sided 95% interval. */
const CI_LOWER = 0.025;
const CI_UPPER = 0.975;

export interface Estimate {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

export interface BootstrapOptions {
  iterations?: number;
  seed?: number;
}

/** Small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function bootstrapCI(xs: number[], options: BootstrapOptions = {}): Estimate {
  const { iterations = BOOTSTRAP_ITERATIONS, seed = BOOTSTRAP_SEED } = options;
  const n = xs.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n };
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) sum += xs[Math.floor(rand() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    mean: mean(xs),
    lo: means[Math.floor(CI_LOWER * iterations)],
    hi: means[Math.floor(CI_UPPER * iterations)],
    n,
  };
}

/** Paired: resamples case indices, so per-question difficulty cancels out. Returns b - a. */
export function pairedBootstrapDiff(
  a: number[],
  b: number[],
  options: BootstrapOptions = {},
): Estimate {
  if (a.length !== b.length) throw new Error('paired bootstrap needs equal-length arrays');
  return bootstrapCI(
    a.map((x, i) => b[i] - x),
    options,
  );
}
