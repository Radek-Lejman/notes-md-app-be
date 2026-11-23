/**
 * The search loop of scripts/rag-eval.ts: answerable cases are scored against their gold,
 * unanswerable ones only give the confidence the abstention report needs.
 */
import { RerankProvider } from '@ai';
import { EvalCase } from '../../src/modules/ai/rag/eval/dataset/schema';
import { scoreRetrieval } from '../../src/modules/ai/rag/eval/metrics/retrieval';
import { CaseResult } from '../../src/modules/ai/rag/eval/report/aggregate';
import { ConfidenceSignals } from '../../src/modules/ai/rag/eval/report/formatAbstention';
import { RagHit } from '../../src/modules/ai/rag/rag.types';
import { RagSearchService } from '../../src/modules/ai/rag/ragSearch.service';
import { Confidence, measureConfidence } from './confidence';

/** Often enough to spot a slowing reranker (thermal throttling) early, rare enough to stay readable. */
const PROGRESS_EVERY = 10;

export interface SearchContext {
  search: RagSearchService;
  reranker: RerankProvider | null;
  userId: string;
  topK: number;
}

interface CaseRun {
  hits: RagHit[];
  latencyMs: number;
  confidence: Confidence;
}

/** Searches every case in order, logging progress; `onCase` turns each search into a result. */
async function searchCases<T>(
  { search, reranker, userId, topK }: SearchContext,
  cases: EvalCase[],
  onCase: (evalCase: EvalCase, run: CaseRun) => T,
): Promise<T[]> {
  const results: T[] = [];
  const startedAll = performance.now();
  for (const evalCase of cases) {
    const started = performance.now();
    const hits = await search.search(userId, evalCase.question, topK);
    const latencyMs = performance.now() - started;
    const confidence = await measureConfidence(reranker, evalCase.question, hits);
    results.push(onCase(evalCase, { hits, latencyMs, confidence }));
    if (results.length % PROGRESS_EVERY === 0 || results.length === cases.length) {
      const elapsedMin = (performance.now() - startedAll) / 60_000;
      console.log(
        `progress: ${results.length}/${cases.length}, last ${(latencyMs / 1000).toFixed(1)}s, ` +
          `elapsed ${elapsedMin.toFixed(1)} min`,
      );
    }
  }
  return results;
}

interface Scored {
  result: CaseResult;
  confidence: Confidence;
}

/** Answerable cases are scored against their gold; unanswerable ones only give a confidence. */
export async function runCases(
  context: SearchContext,
  cases: EvalCase[],
  unanswerable: EvalCase[],
) {
  const scored = await searchCases<Scored>(
    context,
    cases,
    (c, { hits, latencyMs, confidence }) => ({
      result: {
        id: c.id,
        type: c.type,
        question: c.question,
        scores: scoreRetrieval(hits, c.gold),
        latencyMs,
      },
      confidence,
    }),
  );
  const abstained = await searchCases(context, unanswerable, (_, { confidence }) => confidence);
  const signals = confidenceSignals([
    ...scored.map(({ confidence }) => ({ answerable: true, confidence })),
    ...abstained.map((confidence) => ({ answerable: false, confidence })),
  ]);
  return { results: scored.map(({ result }) => result), signals };
}

function confidenceSignals(
  samples: { answerable: boolean; confidence: Confidence }[],
): ConfidenceSignals {
  const signals: ConfidenceSignals = {
    semantic: samples.map(({ answerable, confidence }) => ({
      answerable,
      score: confidence.semantic,
    })),
  };
  if (samples.some(({ confidence }) => confidence.rerank !== null)) {
    signals.rerank = samples.map(({ answerable, confidence }) => ({
      answerable,
      score: confidence.rerank ?? 0,
    }));
  }
  return signals;
}
