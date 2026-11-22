import { HEADING_PATH_SEPARATOR } from '../../chunkMarkdown';
import { RagHit } from '../../rag.types';
import { GoldRef } from '../dataset/schema';

const RETRIEVAL_KS = [1, 3, 5, 10] as const;
/** nDCG and MRR look at the first 10 notes - the largest k we report. */
const RANK_DEPTH = 10;
/** Roughly what ends up in the LLM context; context precision and size are measured here. */
const CONTEXT_WINDOW = 5;
/** Rough chars-per-token estimate. Polish tokenizes worse than English - treat as relative. */
const CHARS_PER_TOKEN = 4;

export interface RetrievalScores {
  /** Rank (1-based) of the first gold note in the deduplicated note ranking; null = not found. */
  firstGoldRank: number | null;
  hit: Record<number, number>;
  recall: Record<number, number>;
  ndcg10: number;
  mrr: number;
  /** Section-level hit@5; null when no gold ref has a heading. */
  sectionHit5: number | null;
  /** Fraction of the top-5 chunks that come from a gold note (noise in the LLM context). */
  contextPrecision5: number;
  /** Rough size of the top-5 context in tokens. */
  contextTokens5: number;
}

type Grades = Map<string, number>;

/** Chunks -> unique note ids, keeping the rank of each note's best chunk. */
export function rankNotes(chunks: RagHit[]): string[] {
  return [...new Set(chunks.map((chunk) => chunk.noteId))];
}

const dcg = (gains: number[]) =>
  gains.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);

/** `grades` is never empty (unanswerable cases are refused), so the ideal DCG is > 0. */
function ndcg(ranked: string[], grades: Grades): number {
  const actual = dcg(ranked.slice(0, RANK_DEPTH).map((path) => grades.get(path) ?? 0));
  const ideal = dcg([...grades.values()].sort((a, b) => b - a).slice(0, RANK_DEPTH));
  return actual / ideal;
}

function hitAndRecall(ranked: string[], grades: Grades) {
  const hit: Record<number, number> = {};
  const recall: Record<number, number> = {};
  for (const k of RETRIEVAL_KS) {
    const found = ranked.slice(0, k).filter((path) => grades.has(path)).length;
    hit[k] = Number(found > 0);
    recall[k] = found / grades.size;
  }
  return { hit, recall };
}

const headingMatches = (chunk: RagHit, heading: string) => {
  const prefix = heading.toLowerCase();
  return chunk.headingPath
    .split(HEADING_PATH_SEPARATOR)
    .some((part) => part.toLowerCase().startsWith(prefix));
};

function sectionHit(topChunks: RagHit[], gold: GoldRef[]): number | null {
  const sections = gold.flatMap(({ note, heading }) => (heading ? [{ note, heading }] : []));
  if (sections.length === 0) return null;
  const found = sections.some(({ note, heading }) =>
    topChunks.some((chunk) => chunk.noteId === note && headingMatches(chunk, heading)),
  );
  return Number(found);
}

function contextPrecision(topChunks: RagHit[], grades: Grades): number {
  if (topChunks.length === 0) return 0;
  return topChunks.filter((chunk) => grades.has(chunk.noteId)).length / topChunks.length;
}

/** `gold[].note` must already be a note id (datasets store vault paths; map them first). */
export function scoreRetrieval(chunks: RagHit[], gold: GoldRef[]): RetrievalScores {
  if (gold.length === 0) {
    throw new Error('scoreRetrieval called for a case without gold (unanswerable)');
  }
  const ranked = rankNotes(chunks);
  const grades: Grades = new Map(gold.map((ref) => [ref.note, ref.grade]));
  const topChunks = chunks.slice(0, CONTEXT_WINDOW);
  const index = ranked.findIndex((path) => grades.has(path));
  const firstGoldRank = index === -1 ? null : index + 1;
  const contextChars = topChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);

  return {
    firstGoldRank,
    ...hitAndRecall(ranked, grades),
    ndcg10: ndcg(ranked, grades),
    mrr: firstGoldRank && firstGoldRank <= RANK_DEPTH ? 1 / firstGoldRank : 0,
    sectionHit5: sectionHit(topChunks, gold),
    contextPrecision5: contextPrecision(topChunks, grades),
    contextTokens5: Math.round(contextChars / CHARS_PER_TOKEN),
  };
}
