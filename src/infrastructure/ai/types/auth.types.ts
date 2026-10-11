/**
 * Whose account a run is billed to. Only Claude adapters use it (Ollama is local).
 * - server: the `claude` login of the host running the backend
 * - claude-oauth-token: a user's own subscription token (`claude setup-token`)
 * - anthropic-api-key: a user's own Console API key (pay-as-you-go)
 */
export type AiAuth =
  | { kind: 'server' }
  | { kind: 'claude-oauth-token'; token: string }
  | { kind: 'anthropic-api-key'; apiKey: string };

export const SERVER_AUTH: AiAuth = { kind: 'server' };
