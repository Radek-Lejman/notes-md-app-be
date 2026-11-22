import { RunComparison } from '../run/compareRuns';
import { formatComparison } from './formatComparison';

const comparison = (overrides: Partial<RunComparison> = {}): RunComparison => ({
  common: 250,
  onlyInBase: [],
  onlyInCurrent: [],
  configChanges: [],
  sameDataset: true,
  sameIndex: true,
  metrics: [
    {
      metric: 'mrr',
      base: 0.565,
      current: 0.6,
      diff: { mean: 0.035, lo: 0.01, hi: 0.06, n: 250 },
      verdict: 'improvement',
    },
    {
      metric: 'contextTokens@5',
      base: 1019.4,
      current: 1001,
      diff: { mean: -18.4, lo: -40, hi: 3, n: 250 },
      verdict: 'noise',
    },
  ],
  ...overrides,
});

describe('formatComparison', () => {
  it('prints base → current, the signed paired difference and the verdict', () => {
    const text = formatComparison(comparison(), 'baseline');

    expect(text).toContain('Compared with baseline on 250 common cases');
    expect(text).toContain('config: unchanged');
    expect(text).toMatch(/mrr +0\.565 → 0\.600 {2}\+0\.035 \[\+0\.010, \+0\.060\] {2}improvement/);
    expect(text).toContain('contextTokens@5  1019 → 1001  -18 [-40, +3]  noise');
    expect(text).toContain('improvement 1 · regression 0 · noise 1');
    expect(text).not.toContain('!');
  });

  it('lists config changes and warns about what else could explain a difference', () => {
    const text = formatComparison(
      comparison({
        configChanges: [{ key: 'minScore', base: 0.45, current: 0.3 }],
        sameDataset: false,
        sameIndex: false,
        onlyInBase: ['q1'],
        onlyInCurrent: [],
      }),
      'x.json',
    );

    expect(text).toContain('config: minScore 0.45 → 0.3');
    expect(text).toContain('! dataset changed');
    expect(text).toContain('! different index');
    expect(text).toContain('! not compared: 1 only in base, 0 only in current');
  });

  it('warns when only the current run has extra cases', () => {
    expect(formatComparison(comparison({ onlyInCurrent: ['q2'] }), 'b')).toContain(
      '0 only in base, 1 only in current',
    );
  });
});
