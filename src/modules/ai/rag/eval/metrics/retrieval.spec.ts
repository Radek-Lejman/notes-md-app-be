import { HEADING_PATH_SEPARATOR } from '../../chunkMarkdown';
import { RagHit } from '../../rag.types';
import { GoldRef } from '../dataset/schema';
import { rankNotes, scoreRetrieval } from './retrieval';

const chunk = (noteId: string, heading = '', content = 'x'.repeat(40)): RagHit => ({
  noteId,
  title: 'T',
  headingPath: ['T', heading].filter(Boolean).join(HEADING_PATH_SEPARATOR),
  content,
  score: 1,
});
const primary = (note: string, heading?: string): GoldRef => ({ note, heading, grade: 2 });

describe('rankNotes', () => {
  it('dedupes chunks to notes keeping best rank', () => {
    expect(rankNotes([chunk('a'), chunk('b'), chunk('a'), chunk('c')])).toEqual(['a', 'b', 'c']);
  });
});

describe('scoreRetrieval', () => {
  it('computes hit/recall/mrr at note level, not chunk level', () => {
    // gold note "g" appears as 3rd *chunk* but 2nd *note*
    const s = scoreRetrieval([chunk('x'), chunk('x'), chunk('g')], [primary('g')]);
    expect(s.firstGoldRank).toBe(2);
    expect(s.hit[1]).toBe(0);
    expect(s.hit[3]).toBe(1);
    expect(s.mrr).toBeCloseTo(0.5);
  });

  it('partial recall with two gold notes', () => {
    const s = scoreRetrieval([chunk('a'), chunk('z')], [primary('a'), { note: 'b', grade: 1 }]);
    expect(s.recall[5]).toBe(0.5);
  });

  it('ndcg is 1 for ideal graded order and lower when swapped', () => {
    const gold: GoldRef[] = [primary('p'), { note: 's', grade: 1 }];
    expect(scoreRetrieval([chunk('p'), chunk('s')], gold).ndcg10).toBeCloseTo(1);
    expect(scoreRetrieval([chunk('s'), chunk('p')], gold).ndcg10).toBeLessThan(1);
  });

  it('mrr is 0 when the first gold note is ranked below 10', () => {
    const misses = Array.from({ length: 10 }, (_, i) => chunk(`miss-${i}`));
    const s = scoreRetrieval([...misses, chunk('g')], [primary('g')]);
    expect(s.firstGoldRank).toBe(11);
    expect(s.mrr).toBe(0);
  });

  it('section hit matches heading prefix case-insensitively', () => {
    const gold = [primary('n', 'plan na start')];
    expect(scoreRetrieval([chunk('n', 'Plan na start')], gold).sectionHit5).toBe(1);
    expect(scoreRetrieval([chunk('n', 'Zasady')], gold).sectionHit5).toBe(0);
    expect(scoreRetrieval([chunk('n')], [primary('n')]).sectionHit5).toBeNull();
  });

  it('context precision counts gold chunks among top 5', () => {
    const s = scoreRetrieval([chunk('g'), chunk('x'), chunk('g'), chunk('y')], [primary('g')]);
    expect(s.contextPrecision5).toBe(0.5);
  });

  it('estimates top-5 context size in tokens', () => {
    const s = scoreRetrieval(
      [chunk('a', '', 'x'.repeat(40)), chunk('b', '', 'x'.repeat(42))],
      [primary('a')],
    );
    expect(s.contextTokens5).toBe(21);
  });

  it('miss -> zeros, not NaN', () => {
    const s = scoreRetrieval([], [primary('g')]);
    expect(s).toMatchObject({ firstGoldRank: null, mrr: 0, ndcg10: 0, contextPrecision5: 0 });
  });

  it('refuses unanswerable cases', () => {
    expect(() => scoreRetrieval([chunk('a')], [])).toThrow('unanswerable');
  });
});
