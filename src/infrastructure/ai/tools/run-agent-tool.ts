import { z } from 'zod';
import { AgentTool } from '../types/agent.types';

export interface AgentToolOutput {
  text: string;
  isError: boolean;
}

/**
 * Shared by all agent adapters: validates model-provided input against the tool
 * schema, runs the handler and serializes the result. Errors are returned (not
 * thrown) so the model can see them and retry with corrected input.
 */
export async function runAgentTool(
  tool: AgentTool | undefined,
  rawInput: unknown,
): Promise<AgentToolOutput> {
  if (!tool) {
    return { text: 'Unknown tool', isError: true };
  }

  const parsed = z.object(tool.inputSchema).safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { text: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
  }

  try {
    const output = await tool.handler(parsed.data);
    return {
      text: typeof output === 'string' ? output : JSON.stringify(output ?? null),
      isError: false,
    };
  } catch (e) {
    return { text: (e as Error).message, isError: true };
  }
}

/** Tool input schema as JSON Schema (format used by most function-calling APIs). */
export function toolInputJsonSchema(tool: AgentTool): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(z.object(tool.inputSchema)) };
  delete schema.$schema;
  return schema;
}
