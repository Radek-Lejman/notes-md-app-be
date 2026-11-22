import { PlannedNote } from 'src/modules/notes/import/importPlan.types';
import { mapGold, noteIdsByPath } from './goldMapping';
import { EvalCase } from './schema';

const planned = (id: string, sourcePath: string | null): PlannedNote => ({
  id,
  parentId: null,
  title: id,
  content: '',
  order: 0,
  sourcePath,
});

const evalCase = (id: string, paths: string[]): EvalCase => ({
  id,
  question: `question ${id}`,
  type: 'fact',
  gold: paths.map((note) => ({ note, grade: 2 })),
  referenceAnswer: '',
  keyFacts: [],
  mustNotClaim: [],
  tags: [],
  origin: 'seed',
  reviewed: true,
  goldHashes: {},
  createdAt: '2026-11-04',
});

describe('noteIdsByPath', () => {
  it('maps source paths to note ids and skips notes without a file', () => {
    const index = noteIdsByPath([planned('root', null), planned('n1', 'A/b.md')]);

    expect([...index]).toEqual([['A/b.md', 'n1']]);
  });
});

describe('mapGold', () => {
  const index = new Map([
    ['A/b.md', 'n1'],
    ['Zdrowie/Wstawać.md', 'n2'],
  ]);

  it('replaces gold paths with note ids and keeps the rest of the case', () => {
    const { cases, unmapped } = mapGold([evalCase('q1', ['A/b.md'])], index);

    expect(cases).toEqual([{ ...evalCase('q1', ['n1']) }]);
    expect(unmapped).toEqual([]);
  });

  it('matches NFD gold paths against NFC import paths', () => {
    const nfd = 'Zdrowie/Wstawać.md'.normalize('NFD');

    expect(mapGold([evalCase('q1', [nfd])], index).cases[0].gold[0].note).toBe('n2');
  });

  it('drops a case with any unmapped gold path and reports every missing path', () => {
    const { cases, unmapped } = mapGold(
      [evalCase('q1', ['A/b.md', 'gone.md', 'also-gone.md']), evalCase('q2', ['A/b.md'])],
      index,
    );

    expect(cases.map((c) => c.id)).toEqual(['q2']);
    expect(unmapped).toEqual([
      { caseId: 'q1', path: 'gone.md' },
      { caseId: 'q1', path: 'also-gone.md' },
    ]);
  });

  it('keeps cases without gold (unanswerable)', () => {
    expect(mapGold([evalCase('q1', [])], index).cases).toHaveLength(1);
  });
});
