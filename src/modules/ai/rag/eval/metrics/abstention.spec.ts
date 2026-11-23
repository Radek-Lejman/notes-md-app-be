import { abstentionTable, auroc, ConfidenceSample } from './abstention';

const answerable = (score: number): ConfidenceSample => ({ answerable: true, score });
const unanswerable = (score: number): ConfidenceSample => ({ answerable: false, score });

describe('auroc', () => {
  it('is 1 when every answerable question outscores every unanswerable one', () => {
    expect(auroc([answerable(0.8), answerable(0.7), unanswerable(0.5)])).toBe(1);
  });

  it('is 0.5 when the scores do not separate the two', () => {
    expect(auroc([answerable(0.6), answerable(0.4), unanswerable(0.5)])).toBe(0.5);
  });

  it('counts ties as half', () => {
    expect(auroc([answerable(0.5), unanswerable(0.5)])).toBe(0.5);
  });

  it('is NaN without one of the two groups', () => {
    expect(auroc([answerable(0.5)])).toBeNaN();
  });
});

describe('abstentionTable', () => {
  it('picks the threshold keeping each share of answerable questions', () => {
    const scores = Array.from({ length: 100 }, (_, i) => answerable(i / 100));
    const rows = abstentionTable([...scores, unanswerable(0.03), unanswerable(0.07)]);

    expect(rows).toEqual([
      { keepAnswerable: 0.99, threshold: 0.01, rejectUnanswerable: 0 },
      { keepAnswerable: 0.95, threshold: 0.05, rejectUnanswerable: 0.5 },
      { keepAnswerable: 0.9, threshold: 0.1, rejectUnanswerable: 1 },
    ]);
  });

  it('is empty without one of the two groups', () => {
    expect(abstentionTable([unanswerable(0.1)])).toEqual([]);
  });
});
