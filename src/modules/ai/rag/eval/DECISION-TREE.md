# RAG retrieval: what to do given the eval results

There is no official, standard decision tree for RAG. This is a synthesis of common retrieval-evaluation practice, mapped to the metrics and commands of this harness. The thresholds are rules of thumb for a personal-notes corpus of a few hundred notes, not industry norms: treat them as starting points and replace them with your own targets once you have a baseline.

Walk the tree top-down. Fix the first problem you hit, re-run with `--compare`, and only then go further down: a measurement problem makes every later decision unreliable.

## 0. Can I trust the numbers?

| Symptom                                                    | Diagnosis                          | Action                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A run compared with itself is not `+0.000` everywhere      | Nondeterminism                     | Find it before anything else (index rebuilt, model, ties)                                               |
| Many stale or unmapped cases                               | Labels rotted or vault paths moved | `npm run rag:dataset -- check`, re-check, re-pin or fix paths                                           |
| Cases `reviewed: false`                                    | Label errors unknown               | Review a random sample of ~30; more than ~10% wrong → fix the generation process before tuning anything |
| A per-type `n` below ~15, or 95% CIs wider than ±10 points | Too few cases to see differences   | Grow the dataset (step 6)                                                                               |
| hit@5 / recall@10 near 1.0 with a CI of `[1.000, 1.000]`   | Ceiling: the dataset is too easy   | Add harder cases (paraphrase, multi_hop, aggregation, near-miss unanswerable)                           |

## 1. Where is the gold note? (`firstGoldRank` per case)

Split the cases: gold at rank 1 · ranks 2–5 · ranks 6–10 · beyond 10 or not found. The largest bucket outside rank 1 picks the branch.

### A. Not found (recall problem): hit@10 or recall@10 low, many "not found"

Look at the missed cases and their question types:

| Pattern                                                 | Likely cause                     | Try                                                                                           |
| ------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Lowering `--min-score` recovers cases                   | The threshold cuts gold          | Lower `minScore` (watch `contextTokens@5`)                                                    |
| `paraphrase` worst                                      | Vocabulary mismatch              | Query rewriting / HyDE, a stronger multilingual embedding model, note title in the chunk text |
| `fact` with names, codes, numbers worst                 | Embeddings blur exact tokens     | A _well-tuned_ keyword or hybrid search (AND query, stemming, lower keyword weight)           |
| `temporal` worst                                        | Dates are not searchable meaning | Date metadata on chunks, filters, dates in the heading path                                   |
| Answer sits across a chunk boundary, or in a huge chunk | Chunking                         | Chunk size/overlap, split on headings, smaller chunks for long notes                          |
| Gold note missing from the index                        | Indexing                         | `RagSearchService.stats`, empty or oversized notes, failed embeddings                         |

### B. Found but ranked low (ranking problem): hit@10 good, hit@1 / MRR low, many at ranks 2–5

| Pattern                                                     | Try                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gold usually within the first ~20 chunks                    | A cross-encoder reranker over the top N (biggest usual gain; the ceiling for hit@1 is the share of cases with gold anywhere in the retrieved list) |
| Hybrid on is worse than off                                 | Fusion noise: AND instead of OR, lower keyword weight in RRF, Polish stemming, stop words                                                          |
| Hub notes (`_index`, maps, folder notes) outrank the answer | Down-weight or exclude hubs, or index only their own text                                                                                          |

### C. Some gold found, the rest missed: recall@10 much lower than hit@10, mostly `multi_hop` / `aggregation`

| Pattern                                     | Try                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Several chunks of one note fill the list    | Diversify: cap chunks per note, MMR                                   |
| Notes needed are about different sub-topics | Query decomposition into sub-questions, iterative (agentic) retrieval |
| Simply not enough notes returned            | Larger `topK` (check the context cost)                                |

### D. Right notes, wrong or noisy context

| Pattern                                          | Try                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| hit@5 good, `sectionHit@5` low                   | Chunk on heading boundaries, smaller chunks                                               |
| `contextPrecision@5` low, `contextTokens@5` high | Fewer chunks into the prompt, a reranker score cut-off, higher `minScore`, smaller chunks |

### E. Unanswerable questions

Not scored yet. Once they are: if the retriever returns confident hits for questions the vault cannot answer, calibrate the score threshold for abstention and make the answerer say "not in your notes".

## 2. Retrieval is good, answers are still bad

Retrieval metrics stop here; this needs the answer eval (`keyFacts`, `mustNotClaim`). Run it twice:

- **Oracle context** (the gold notes given directly): bad answers → the prompt or the model.
- **Real retrieval**: bad only here → context assembly (order, size, truncation) or retrieval after all.

## 3. Accepting a change

- One change per run, `--compare` against the baseline; accept only an `improvement` verdict on the metrics you target.
- Check every question type for a `regression`: an overall gain can hide a loss on one type.
- Weigh the cost: `contextTokens@5`, latency, an extra model (reranker) to run.
- A product default (e.g. `RAG_HYBRID`) changes behaviour for every user: decide it consciously, not from one eval run.
