# RAG reranker: plan

Status: implemented behind `RAG_RERANK_PROVIDER`, 2026-11-14; on by default (`local`, 20 candidates) since 2026-11-22, after the full-label eval.

## Why

Retrieval eval (`npm run rag:eval`, see `src/modules/ai/rag/eval/README.md`), semantic only (`RAG_HYBRID=false`), `minScore` 0.3, 245–250 answerable cases:

| Signal                                         | Value                       | Meaning                                         |
| ---------------------------------------------- | --------------------------- | ----------------------------------------------- |
| hit@1 vs hit@10                                | 0.58 vs 0.91                | a third of cases: gold retrieved, but not first |
| first gold rank                                | 1: 58%, 2–10: 31%, >10: 11% | most misses are ordering, not recall            |
| multi-gold cases partially found in top 10     | 40                          | 49 gold notes missing from the top 10           |
| … of those 49, ranked 11–40 among unique notes | 34                          | retrieved, ranked too low                       |
| … not retrieved even in the top 80 chunks      | 13                          | a recall problem (query decomposition, later)   |

Both the "gold ranked low" and the "some gold missing" problems are mostly ordering problems, which is what a cross-encoder reranker fixes. Expected ceiling for hit@1: the share of cases with gold anywhere in the candidate list (about 0.91 at 20 candidates).

## How it works

```
question -> embedding -> pgvector: top N candidates (fast, coarse)
                                  -> reranker scores each (question, chunk) pair together (slow, precise)
                                  -> sort by reranker score -> top K
```

A bi-encoder embeds the question and the chunk separately and compares vectors; a cross-encoder reads both at once, so it judges whether the chunk answers the question.

## Choice: local cross-encoder via `@huggingface/transformers`

The local embedding provider already runs ONNX models on CPU in a worker process with this library, so there is no new dependency and no new service, and private notes never leave the machine.

Rejected: Ollama (no rerank endpoint), Hugging Face TEI container (one more service), Cohere / Voyage APIs (notes leave the machine), an LLM as reranker (slow, nondeterministic).

Model: `bge-reranker-v2-m3` (multilingual, Polish). To verify in step 1: an ONNX build loadable by transformers.js, size, licence (`jina-reranker-v2` is non-commercial, so it is out).

## Design

1. `src/infrastructure/ai`: `RerankProvider` (`rerank(query, texts, signal): Promise<number[]>`), a DI token, a factory (`none` | `local`), a worker process following `local-embedding` (share the worker plumbing only if it stays simple).
2. Config: `RAG_RERANK` (`none` | `local`, default `none`: product behaviour unchanged), `RAG_RERANK_MODEL`, `RAG_RERANK_CANDIDATES` (default 40).
3. `RagSearchService.search`: when enabled, fetch `max(limit, candidates)` chunks, rerank, sort, cut to `limit`. If the reranker fails, keep the embedding order and log a warning.
4. Eval: `EvalConfig.rerank` (shown in `--compare` config changes) and per-question latency (p50 / p95). The index is untouched, so runs reuse it.

## Experiments

Each against `sem-ms03` (semantic, `minScore` 0.3), one change per run:

1. Reranker over 40 candidates.
2. Reranker over 20 candidates (cheaper?).
3. Reranker + hybrid: hybrid hurt through ordering, but its keyword matches may add gold to the candidate pool.
4. A/A with the reranker (determinism).

Accept if: hit@1 about 0.70 and recall@10 above 0.85, no `regression` in any question type, acceptable p95 latency.

## Risks

- Memory: about 1 GB more for the reranker worker.
- CPU latency: estimated 1–3 s per question at 40 candidates (measure, do not assume).
- Production (Railway): the same cost. Enabled by default on 2026-11-22 (product decision); `RAG_RERANK_PROVIDER=none` turns it off.
- Docker compose: off unless `RAG_RERANK_PROVIDER_DOCKER=local` (2026-11-25), until the model cache gets a volume; otherwise a recreated container downloads the model again on its first chat.

## Steps

Each ends with green `npm run verify` and `npm run test:ai`.

1. Spike outside the repo: load the model, time 40 pairs. Go / no-go.
2. Provider and worker with tests.
3. Wire into `RagSearchService` behind the flag.
4. Eval config and latency.
5. Experiment runs and a results write-up.

Later, for the cases not retrieved at all (mostly `aggregation`, `multi_hop`): query decomposition.
