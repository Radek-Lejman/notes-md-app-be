# AI module (src/modules/ai) — read with src/infrastructure/ai

Medium risk; `credentials/` is high risk (see root CLAUDE.md).

- Providers come from factories in `@ai` and are injected by token: `AGENT_PROVIDER`, `LLM_PROVIDER`, embeddings. Do not instantiate SDK clients in services.
- The agent's tools (`tools/notes.tools.ts`) are read-only and get `userId` bound in `createNotesTools` from the JWT. The model never chooses whose data it reads — keep it that way for every new tool.
- Note content (and anything retrieved by RAG) is untrusted input: it can contain prompt injection. Never give the agent write tools, shell, files or network because a note asked for it.
- The Claude Agent SDK provider runs with `tools: []`, `settingSources: []`, `strictMcpConfig: true`, `cwd: tmpdir()` — only our MCP tools. Do not loosen these.
- Per-user Claude credentials (`credentials/`): encrypted with `SecretBox` bound to the user id, never returned by the API and never logged (not even partially beyond the stored hint). Concurrency limits: `AiRunLimiter`.
- Keyword search (`tools/keywordSearch.tool.ts`): replaces the basic `search_notes` when `AI_AGENT_KEYWORD_SEARCH=true` (default); self-contained, removal steps in its header.
- RAG: `rag/chunkMarkdown.ts` → `ragIndexer.service.ts` (embeddings in pgvector) → `ragSearch.service.ts`; queries scoped by `userId`. Embeddings: `ollama` or `local` (`@ai/providers/local`: model in a child process started on demand, stopped when idle; the child gets no app secrets in its env). Hybrid search (`rag/hybridSearch.ts`, `RAG_HYBRID`): semantic + keyword chunk results fused with RRF; removal steps in its header.
- Tests: unit tests use the mocks in `src/infrastructure/ai/testing/ai-test.utils.ts`; the SDK itself is mocked in `src/__mocks__/@anthropic-ai/claude-agent-sdk.ts`. `npm run test:ai` must stay at 100% coverage. Real models only in `npm run ai:smoke` (never in CI).
