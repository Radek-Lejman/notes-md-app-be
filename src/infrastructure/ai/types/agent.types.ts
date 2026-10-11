import type { z } from 'zod';
import type { AiAuth } from './auth.types';

/**
 * Provider-agnostic agent contract. An agent = LLM + tool-calling loop.
 * Feature modules define tools in this format; each adapter translates them
 * to its vendor's tool/function-calling API.
 */
export const AGENT_PROVIDER = Symbol('AGENT_PROVIDER');

export type AgentProviderName = 'claude-agent-sdk' | 'ollama';
// Next candidates: 'openai-agents' | 'anthropic-api'

export interface AgentTool<TShape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: TShape;
  /** Return value is serialized to JSON and passed back to the model. */
  handler: (input: z.infer<z.ZodObject<TShape>>) => Promise<unknown>;
}

/** Keeps handler input typed against the schema. */
export function defineAgentTool<TShape extends z.ZodRawShape>(tool: AgentTool<TShape>): AgentTool {
  return tool as unknown as AgentTool;
}

export interface AgentRunRequest {
  task: string;
  systemPrompt?: string;
  tools: AgentTool[];
  /** Aborts the run (e.g. client disconnected). */
  signal?: AbortSignal;
  /** Account to run on; defaults to the server login. */
  auth?: AiAuth;
}

export type AgentEvent =
  /** Incremental chunk of the text block being generated (only from streaming providers). */
  | { type: 'text_delta'; text: string }
  /** A complete text block. Always sent, also after its text_delta chunks. */
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; isError: boolean }
  | { type: 'done'; text: string; turns: number; durationMs: number }
  | { type: 'error'; message: string };

export interface AgentProvider {
  readonly name: AgentProviderName;
  /** True when runs are billed to a user account (Claude), so `auth` matters. */
  readonly usesAccountAuth: boolean;
  run(request: AgentRunRequest): AsyncIterable<AgentEvent>;
}
