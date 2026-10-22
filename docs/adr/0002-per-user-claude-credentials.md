# 0002 — AI on the user's own account, credentials encrypted with `SecretBox`

Status: **accepted** (2026-10-10, migration `20261010200000_add_rag_and_ai_credentials`) · written retroactively 2026-10-14

## Context

The AI features (assist, chat, an agent with note tools) use Claude models. A shared server key means the costs and rate limits of all users go to one account, and one user's abuse exhausts the limit for everyone else. Users often have their own Claude subscription.

## Decision

Each user connects **their own** credentials: a subscription token (`claude-oauth-token`) or an API key (`anthropic-api-key`); the format is validated with a regular expression on save (`credential.types.ts`).

- The secret is stored in the `AiCredential` table (primary key `userId`), encrypted with `SecretBox`: AES-256-GCM, key = SHA-256 of `AI_CREDENTIALS_SECRET` (≥ 32 bytes), **user id as AAD** — a ciphertext copied to another row does not decrypt. The `v1:iv:tag:ciphertext` format allows a future algorithm change.
- The API never returns the secret — only status, type and a short suffix (hint) for recognition.
- The provider (`AGENT_PROVIDER`) decides whether it needs the user's account (`usesAccountAuth`); local models (Ollama) work without credentials.
- Run concurrency is limited globally and per user (`AiRunLimiter`).

## Alternatives

- **Shared server key** — simpler, but cost and limits are shared and abuse is not isolated.
- **KMS / vault** — better key management and rotation, disproportionate for a project without cloud infrastructure. Revisit if the app goes to production with real users.
- **Storing it in the browser** — the secret in frontend JS, exposed to XSS; the agent runs server-side anyway.

## Consequences

- Losing or changing `AI_CREDENTIALS_SECRET` invalidates all stored credentials (users reconnect them) — rotation needs a re-encryption script.
- Code in `src/modules/ai/credentials/**` and `src/infrastructure/security/crypto/**` is a high-risk path: the secret must never reach logs, responses or errors.
- Unit tests cover rejecting a ciphertext with a different context/key/after tampering; a candidate for mutation testing (`docs/ai-dev-system/CONCEPT.md`, phase 4).
