import { fuseRrf, RRF_K } from './hybridSearch';
import { RagHit } from './rag.types';

const chunk = (noteId: string, content = `text of ${noteId}`): RagHit => ({
  noteId,
  title: noteId.toUpperCase(),
  headingPath: noteId,
  content,
  score: 0.5,
});
const ids = (hits: RagHit[]) => hits.map((hit) => hit.noteId);

describe('fuseRrf', () => {
  it('puts a chunk ranked in both lists above chunks found by one list only', () => {
    const semantic = [chunk('a'), chunk('b'), chunk('c')];
    const keyword = [chunk('c'), chunk('d')];

    // c: 1st + 3rd; a: 1st; b and d: 2nd in one list each (tie keeps the first seen).
    expect(ids(fuseRrf([semantic, keyword], 10))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('scales the fused score to 0..1 (1 = first in every list)', () => {
    const [top, second] = fuseRrf([[chunk('a'), chunk('b')], [chunk('a')]], 10);

    expect(top.score).toBe(1);
    expect(second.score).toBeCloseTo(1 / (RRF_K + 2) / (2 / (RRF_K + 1)));
  });

  it('keeps chunks of different notes (or different text) apart', () => {
    const fused = fuseRrf([[chunk('a', 'same')], [chunk('b', 'same'), chunk('a', 'other')]], 10);
    expect(fused).toHaveLength(3);
  });

  it('returns at most `limit` chunks and handles empty lists', () => {
    expect(fuseRrf([[chunk('a'), chunk('b')], [chunk('c')]], 2)).toHaveLength(2);
    expect(fuseRrf([[], []], 5)).toEqual([]);
  });

  it('keeps the chunk data from the first list that found it', () => {
    const [hit] = fuseRrf([[{ ...chunk('a'), title: 'Semantic' }], [chunk('a')]], 1);
    expect(hit.title).toBe('Semantic');
  });
});
