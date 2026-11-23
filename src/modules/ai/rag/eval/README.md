# RAG retrieval eval

## Purpose

Offline evaluation of RAG retrieval against a golden question set. For each case the retriever's chunks are collapsed to a note ranking and scored with hit@k and recall@k (k = 1, 3, 5, 10), MRR and nDCG@10, plus section-level hit@5 and top-5 context precision. Aggregates carry a seeded bootstrap CI; comparing two configurations uses a paired bootstrap over the same cases, because with ~100 cases a 2-point difference is usually noise.

Not part of the request path: nothing here is wired into `AiModule` or any controller.

## Origin

Copied from `~/projects/second-brain-rag` @ `c5ef4b9` ("Eval harness for second-brain RAG: retrieval + answer evaluation"). That repo stays the reference implementation; this is a plain copy, no git subtree or submodule. Changes made here that matter upstream are ported back by hand.

## Files

| File                             | From                       | Contents                                                                                                             |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `metrics/retrieval.ts`           | `src/metrics/retrieval.ts` | `rankNotes`, `scoreRetrieval`, `RETRIEVAL_KS`                                                                        |
| `metrics/stats.ts`               | `src/metrics/stats.ts`     | `mean`, `bootstrapCI`, `pairedBootstrapDiff` (seeded `mulberry32`)                                                   |
| `dataset/schema.ts`              | `src/dataset/schema.ts`    | only `GoldRef`, `QuestionType`, `EvalCase`, `readJsonl` (zod)                                                        |
| `metrics/retrieval.spec.ts`      | `tests/metrics.test.ts`    | ported from Vitest to Jest                                                                                           |
| `metrics/stats.spec.ts`          | `tests/metrics.test.ts`    | bootstrap tests, plus PRNG/`mean` cases for 100% `test:ai` coverage                                                  |
| `dataset/schema.spec.ts`         | —                          | new: `readJsonl` (comments, defaults, missing file, error line)                                                      |
| `dataset/goldMapping.ts`         | —                          | new: `noteIdsByPath`, `mapGold` (vault path → note id, unmapped reported)                                            |
| `dataset/readDataset.ts`         | —                          | new: a dataset file or folder of `.jsonl` files, ids unique across them                                              |
| `dataset/readVault.ts`           | —                          | new: vault files in import format (dot folders skipped)                                                              |
| `dataset/staleness.ts`           | `src/dataset/schema.ts`    | `hashVault`, `checkStaleness`, `findStale`, `pinHashes` (upstream: `checkStaleness`/`pinHashes`)                     |
| `metrics/abstention.ts`          | —                          | new: `auroc`, `abstentionTable` (answerable vs unanswerable by best score)                                           |
| `report/formatAbstention.ts`     | —                          | new: abstention section of the report, one block per confidence signal                                               |
| `scripts/rag-eval/runCases.ts`   | —                          | new: the search loop (progress log; scores answerable cases, collects confidence of all)                             |
| `scripts/rag-eval/confidence.ts` | —                          | new: best semantic score and the reranker's score of the top hit                                                     |
| `report/aggregate.ts`            | —                          | new: per-metric mean + bootstrap CI, overall and per question type                                                   |
| `report/formatReport.ts`         | —                          | new: text report (config, CIs, per type, missed cases, unmapped)                                                     |
| `run/evalConfig.ts`              | —                          | new: the retrieval settings a run depends on                                                                         |
| `scripts/rag-eval.ts`            | —                          | new: the runner (`npm run rag:eval`)                                                                                 |
| `run/indexCache.ts`              | —                          | new: index fingerprint (vault files + embedding model + chunk size/overlap) and the cache file                       |
| `run/runRecord.ts`               | —                          | saved run schema (config, dataset hash, index fingerprint, per-case metrics), write/read, `--compare <label>` lookup |
| `run/compareRuns.ts`             | —                          | paired bootstrap per metric on common case ids, verdict improvement / regression / noise                             |
| `report/formatComparison.ts`     | —                          | text table of a comparison, with warnings (config, dataset, index changed)                                           |
| `scripts/rag-eval/evalIndex.ts`  | —                          | new: import into the eval user, indexing, cache reuse                                                                |
| `scripts/rag-dataset.ts`         | `src/cli/dataset.ts`       | `npm run rag:dataset -- check \| pin [--ids a,b]`                                                                    |
| `scripts/rag-eval/evalPaths.ts`  | —                          | vault/dataset from flags or env, shared by both scripts                                                              |
| `scripts/rag-eval/saveRun.ts`    | —                          | saves the run to `eval-runs/`, prints the comparison                                                                 |

Out of scope: the answerer, the LLM judge and the corpus loader.

What to change given the results: [DECISION-TREE.md](DECISION-TREE.md).

## Running

Needs the database (`docker compose up -d db`) and the embedding provider (e.g. Ollama with `bge-m3`); never in CI.

```bash
npm run rag:eval                         # vault and dataset from RAG_EVAL_VAULT / RAG_EVAL_DATASET
npm run rag:eval -- --vault <dir>        # or explicitly
npm run rag:eval -- --dataset <file|dir> # one .jsonl file, or every .jsonl file of a folder
npm run rag:eval -- --min-score 0.3      # override RAG_MIN_SCORE for this run
npm run rag:eval -- --top-k 10           # chunks per question (default 20)
npm run rag:eval -- --reindex            # ignore the index cache, re-import and re-embed
npm run rag:eval -- --include-stale      # also score cases whose gold notes changed
npm run rag:eval -- --label baseline     # name the saved run
npm run rag:eval -- --compare baseline   # paired comparison with the newest run of that label (or a file)
```

Env comes from the worktree's `.env`, then from the optional `~/.config/notes-app-be/rag-eval.env`, whose values win. Keep machine-specific settings there, outside the repo:

```bash
DATABASE_URL=<your .env DATABASE_URL with host localhost:5433>   # host port, not docker's db:5432
RAG_EVAL_VAULT="/path/to/vault"
RAG_EVAL_DATASET="/path/to/datasets"   # e.g. ~/projects/second-brain-rag/data
```

## Datasets

The golden datasets are not in this repo: they are questions about a private vault, and the repo is public. They live in `~/projects/second-brain-rag/data` (`golden.jsonl`: 22 hand-written seeds, `golden-300.jsonl`: ~300 synthetic cases, all reviewed in the 2026-11 label audit), the single place where labels are edited; `RAG_EVAL_DATASET` points there. One case per line, schema in `dataset/schema.ts`; ids must be unique across the files of a folder. Do not copy them into the repo, not even gitignored: one `git add -f` publishes them.

### Runs and comparisons

Every run is saved to `eval-runs/<time>[_<label>].json` (gitignored): config, dataset hash, index fingerprint, excluded cases and per-case metrics. `--compare` pairs the new run with an earlier one on the case ids both scored and bootstraps the per-case differences: a metric is an improvement or a regression only when its 95% interval excludes 0, otherwise noise. Smaller is better for `contextTokens@5`.

Change one thing per run, and read the warnings: a different dataset hash means labels changed; a different index fingerprint means the vault was edited or re-embedded, which alone moves a case or two. Search-time settings can be overridden per run from the shell (`RAG_HYBRID=false npm run rag:eval -- --compare baseline`), since the shell beats both env files. A run against itself should show `+0.000` everywhere (A/A test) except `latencyMs`, the search time per question, which is measured and so never repeats exactly: if anything else moves, something is nondeterministic. Reranking is a search-time setting too (`RAG_RERANK_PROVIDER=local npm run rag:eval -- --compare sem-ms03`); the run records the reranker model and `RAG_RERANK_CANDIDATES`, and `latencyMs` shows what it costs.

### Abstention

Unanswerable cases have no gold, so they get no retrieval metrics. They are still searched, to check whether the best score tells them apart from answerable ones, i.e. whether a "nothing relevant in your notes" threshold would work. Per signal (`semantic`: best cosine similarity, 0 when nothing passed `minScore`; `rerank`: the reranker's score of the top hit) the report prints AUROC (0.5 = the score says nothing, 1 = a perfect threshold exists) and, for keeping 99/95/90% of answerable questions, the threshold and the share of unanswerable ones it would reject. Not saved in the run file, so not compared between runs.

### Stale labels

Every gold note carries the sha256 of its raw file at labelling time (`goldHashes`). The vault keeps changing, so a label can rot: a changed gold note does not make it wrong, only unconfirmed.

```bash
npm run rag:dataset -- check              # stale / unpinned cases, type mix, gold coverage
npm run rag:dataset -- pin --ids a,b      # re-pin AFTER re-checking those cases by hand
npm run rag:dataset -- pin                # pin cases that have no hashes yet
```

`rag:eval` lists stale cases (a gold note changed or is gone) and leaves them out of scoring; `--include-stale` scores them anyway. Unpinned cases are scored. Pinning rewrites the dataset files in place: `//` comments and fields outside the schema are dropped.

A worktree has no `.env` of its own: symlink the main checkout's (`ln -s <main checkout>/.env .env`).

The first run imports the vault into the user `rag-eval@local.invalid` (no usable password) through `ImportNotesDto` + `NotesImportService`, so content is normalized as in an HTTP import, then drains `RagIndexerService` until every note is indexed. Gold paths map to note ids through the import plan's `sourcePath`, replayed with the same ids.

Later runs reuse that index (`eval-runs/.cache/index.json`, gitignored) while its fingerprint matches: the vault files plus the embedding model, chunk size and overlap. Search-time settings (`--min-score`, `--top-k`, `RAG_HYBRID`) do not invalidate it, so comparing them takes seconds, and every run queries the same chunks: a re-import embeds again and moves scores by a case or two on its own. The cache is also dropped when the eval user's notes no longer match it. The indexer is not per user: a rebuild also indexes other users' stale notes in that database.

## Adaptation points

- **Jest instead of Vitest** — `describe`/`it`/`expect` mostly carry over; `vi.*` → `jest.*`; test files are `*.spec.ts` next to the code.
- **CommonJS** — the source repo is ESM (`"type": "module"`); here no `.js` import suffixes, no top-level `await`, and `node:` imports as in the rest of the backend.
- **No `contracts.ts`** — upstream's `RetrievedChunk` duplicates `RagHit`, so the metrics take `RagHit[]` directly; `Retriever` had no caller and was dropped (no `index()` needed: notes are indexed by the import flow and `RagIndexerService`). Section matching splits `RagHit.headingPath` on `HEADING_PATH_SEPARATOR` from `chunkMarkdown.ts`.
- **Gold paths vs. note ids** — a dataset labels gold by vault file path (`GoldRef.note`), while `RagHit` carries `noteId`. Before `scoreRetrieval`, gold paths are mapped to note ids (separate step, e.g. from the import result); the metrics only compare ids.
- **Code-quality rules (CLAUDE.md)** — `scoreRetrieval` split into small steps, magic numbers named (`RANK_DEPTH`, `CONTEXT_WINDOW`, `BOOTSTRAP_ITERATIONS`, `BOOTSTRAP_SEED`), nested ternary removed; `bootstrapCI`/`pairedBootstrapDiff` take `{ iterations, seed }` instead of positional args. Results are the same as upstream.
- **`dataset/schema.ts` trimmed** — the original imports `Note`/`sha256` from the corpus loader; those parts are dropped with it.
- **Coverage** — `npm run test:ai` collects `modules/ai/**` at 100%, so every ported file has its own spec (`stats.spec.ts`, `schema.spec.ts` are additions).
- **Module boundaries** — this folder lives in `modules/ai` and may import only `core`, `common`, `infrastructure`, `modules/ai` and `modules/notes` (ADR 0004).
