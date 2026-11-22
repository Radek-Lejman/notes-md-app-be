import { bootstrapCI, mean, mulberry32, pairedBootstrapDiff } from './stats';

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const values = Array.from({ length: 100 }, () => a());
    expect(values).toEqual(Array.from({ length: 100 }, () => b()));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});

describe('mean', () => {
  it('averages and returns NaN for no data', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNaN();
  });
});

describe('bootstrapCI', () => {
  it('is deterministic and brackets the mean', () => {
    const xs = [0, 1, 1, 0, 1, 1, 1, 0, 1, 1];
    const a = bootstrapCI(xs);
    expect(a).toEqual(bootstrapCI(xs));
    expect(a.lo).toBeLessThanOrEqual(a.mean);
    expect(a.hi).toBeGreaterThanOrEqual(a.mean);
    expect(a.n).toBe(10);
  });

  it('returns NaN bounds for no data', () => {
    expect(bootstrapCI([])).toEqual({ mean: NaN, lo: NaN, hi: NaN, n: 0 });
  });
});

describe('pairedBootstrapDiff', () => {
  it('detects a consistent improvement of b over a', () => {
    const a = Array<number>(30).fill(0);
    const b = a.map((_, i) => (i % 3 === 0 ? 0 : 1));
    expect(pairedBootstrapDiff(a, b).lo).toBeGreaterThan(0);
  });

  it('refuses arrays of different length', () => {
    expect(() => pairedBootstrapDiff([1], [1, 2])).toThrow('equal-length');
  });
});
