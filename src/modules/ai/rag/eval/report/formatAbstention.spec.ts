import { formatAbstention } from './formatAbstention';

describe('formatAbstention', () => {
  it('prints AUROC and threshold rows per signal', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => ({ answerable: true, score: 0.5 + i / 100 })),
      { answerable: false, score: 0.2 },
    ];

    const lines = formatAbstention({ semantic: samples });

    expect(lines[1]).toBe('Abstention (best score, 10 answerable vs 1 unanswerable):');
    expect(lines[2]).toBe('  semantic: AUROC 1.000');
    expect(lines[3]).toBe('    threshold 0.500: keeps 99% answerable, rejects 100% unanswerable');
  });

  it('prints nothing without signals', () => {
    expect(formatAbstention({})).toEqual([]);
  });
});
