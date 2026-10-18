import { RagHit } from './rag.types';

/**
 * Hybrid RAG search: fuses the semantic (vector) and keyword (full-text) result lists of the
 * same question with Reciprocal Rank Fusion. Each list votes 1 / (k + rank) for a chunk, so a
 * chunk ranked high in both lists wins; only ranks matter, not the incomparable raw scores
 * (cosine similarity vs ts_rank).
 *
 * Switch: RAG_HYBRID (default true). Off = semantic results only.
 * To remove: delete this file and its spec, the `hybrid` branch in RagSearchService.search,
 * RagRepository.keywordSearch, `rag.hybrid` in aiModule.config.ts, RAG_HYBRID in .env.example,
 * and the NoteChunk_content_fts_idx index (new migration: DROP INDEX).
 */

/** Usual RRF constant: damps the difference between the first few ranks. */
export const RRF_K = 60;

/** One chunk = one note fragment; the same text in two notes stays two chunks. */
const chunkKey = (hit: RagHit) => `${hit.noteId}\u0000${hit.headingPath}\u0000${hit.content}`;

/**
 * Best `limit` chunks of all lists. `score` is the fused score scaled to 0..1, where 1 means
 * "ranked first in every list".
 */
export function fuseRrf(lists: RagHit[][], limit: number, k = RRF_K): RagHit[] {
  const fused = new Map<string, { hit: RagHit; score: number }>();

  for (const list of lists) {
    list.forEach((hit, rank) => {
      const key = chunkKey(hit);
      const entry = fused.get(key) ?? { hit, score: 0 };
      entry.score += 1 / (k + rank + 1);
      fused.set(key, entry);
    });
  }

  const maxScore = lists.length / (k + 1);
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, score: Math.min(1, score / maxScore) }));
}
