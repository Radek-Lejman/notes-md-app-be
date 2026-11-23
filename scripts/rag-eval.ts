/**
 * RAG retrieval eval against a golden dataset (src/modules/ai/rag/eval/README.md).
 * Real DB + real embedding provider, so never in CI.
 *
 *   npm run rag:eval [-- --vault <dir>] [--dataset <file|dir>] [--min-score 0.3] [--top-k 10]
 *                    [--reindex] [--include-stale] [--label baseline] [--compare <label|file>]
 *
 * Env: the worktree's `.env`, then the optional `~/.config/notes-app-be/rag-eval.env`, whose
 * values win: e.g. a host DATABASE_URL (localhost:5433, not docker's db:5432) and
 * RAG_EVAL_VAULT / RAG_EVAL_DATASET, the defaults for --vault / --dataset. Datasets hold
 * private notes, so they live outside the repo.
 *
 * The vault is imported into a dedicated user and indexed once; later runs reuse it until the
 * vault or the index settings change (rag-eval/evalIndex.ts). --reindex forces a fresh import.
 *
 * Cases whose gold notes changed since labelling are reported and not scored (--include-stale
 * scores them anyway); re-check them and re-pin with `npm run rag:dataset -- pin --ids …`.
 *
 * Every run is saved to eval-runs/; --compare runs a paired comparison with an earlier one.
 */
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { RERANK_PROVIDER, RerankProvider } from '@ai';
import { AppModule } from '../src/app.module';
import { AI_MODULE_CONFIG, AiModuleConfig } from '../src/modules/ai/config/aiModule.config';
import { mapGold } from '../src/modules/ai/rag/eval/dataset/goldMapping';
import { readDataset } from '../src/modules/ai/rag/eval/dataset/readDataset';
import { readVault } from '../src/modules/ai/rag/eval/dataset/readVault';
import { findStale, hashVault } from '../src/modules/ai/rag/eval/dataset/staleness';
import { aggregate } from '../src/modules/ai/rag/eval/report/aggregate';
import { formatReport } from '../src/modules/ai/rag/eval/report/formatReport';
import { EvalConfig } from '../src/modules/ai/rag/eval/run/evalConfig';
import { assertRunLabel, datasetHash, toRunCase } from '../src/modules/ai/rag/eval/run/runRecord';
import { RagSearchService } from '../src/modules/ai/rag/ragSearch.service';
import { formatAbstention } from '../src/modules/ai/rag/eval/report/formatAbstention';
import { runCases } from './rag-eval/runCases';
import { prepareEvalIndex } from './rag-eval/evalIndex';
import { EVAL_PATH_OPTIONS, evalPaths } from './rag-eval/evalPaths';
import { saveRun } from './rag-eval/saveRun';

/** Recall@10 needs 10 notes; chunks of one note collapse, so ask for more chunks than that. */
const DEFAULT_TOP_K = 20;

function readArgs() {
  const { values } = parseArgs({
    options: {
      ...EVAL_PATH_OPTIONS,
      'min-score': { type: 'string' },
      'top-k': { type: 'string', default: String(DEFAULT_TOP_K) },
      reindex: { type: 'boolean', default: false },
      'include-stale': { type: 'boolean', default: false },
      label: { type: 'string' },
      compare: { type: 'string' },
    },
  });
  return {
    ...evalPaths(values),
    minScore: values['min-score'],
    topK: Number(values['top-k']),
    reindex: values.reindex,
    includeStale: values['include-stale'],
    label: values.label ?? null,
    compare: values.compare,
  };
}

async function main() {
  const args = readArgs();
  assertRunLabel(args.label);
  // Read by the AI config on first use, i.e. after the overrides below (they beat .env).
  if (args.minScore) process.env.RAG_MIN_SCORE = args.minScore;
  process.env.RAG_INDEX_DEBOUNCE_MS = '0';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const search = app.get(RagSearchService);
    if (!search.enabled) throw new Error('RAG is disabled (RAG_ENABLED=false)');
    const { rag } = app.get<AiModuleConfig>(AI_MODULE_CONFIG);
    const config: EvalConfig = {
      embeddingModel: search.model,
      chunkSize: rag.chunkSize,
      chunkOverlap: rag.chunkOverlap,
      minScore: rag.minScore,
      topK: args.topK,
      hybrid: rag.hybrid,
      rerankModel: search.rerankModel,
      rerankCandidates: search.rerankModel ? rag.rerankCandidates : null,
    };

    const files = await readVault(args.vault);
    const { userId, idByPath, reused, fingerprint } = await prepareEvalIndex(app, {
      files,
      settings: config,
      reindex: args.reindex,
    });
    console.log(reused ? 'index: reused (vault and settings unchanged)' : 'index: rebuilt');

    const all = await readDataset(args.dataset);
    const stale = findStale(all, hashVault(files));
    const staleIds = new Set(stale.map(({ caseId }) => caseId));
    const answerable = all.filter(
      (c) => c.type !== 'unanswerable' && (args.includeStale || !staleIds.has(c.id)),
    );
    const { cases, unmapped } = mapGold(answerable, idByPath);

    const unanswerable = all.filter((c) => c.type === 'unanswerable');
    const reranker = app.get<RerankProvider | null>(RERANK_PROVIDER, { strict: false });
    const { results, signals } = await runCases(
      { search, reranker, userId, topK: args.topK },
      cases,
      unanswerable,
    );

    const aggregates = aggregate(results);
    console.log(
      formatReport({
        config,
        aggregates,
        results,
        unmapped,
        unanswerable: unanswerable.length,
        stale,
        staleIncluded: args.includeStale,
      }),
    );
    console.log(formatAbstention(signals).join('\n'));

    await saveRun(
      {
        createdAt: new Date().toISOString(),
        label: args.label,
        config,
        datasetHash: datasetHash(all),
        indexFingerprint: fingerprint,
        excluded: {
          stale: args.includeStale ? [] : [...staleIds],
          unmapped: [...new Set(unmapped.map(({ caseId }) => caseId))],
        },
        overall: aggregates.overall,
        cases: results.map(toRunCase),
      },
      args.compare,
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('ERR', (e as Error).message);
  process.exit(1);
});
