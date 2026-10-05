import { Logger } from '@nestjs/common';
import { tmpdir } from 'node:os';
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentEvent, AgentProvider, AgentRunRequest, AgentTool } from '../../types/agent.types';
import { ClaudeAgentSdkConfig } from '../../config/ai.config';
import { LlmProviderError } from '../../errors/llm-provider.error';
import { runAgentTool } from '../../tools/run-agent-tool';

const MCP_SERVER_NAME = 'app';
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/**
 * Agent loop via Claude Agent SDK (the engine behind Claude Code).
 * Auth comes from the local Claude login, so runs count against the Pro/Max
 * subscription. Dev/POC only — a multi-user product needs API-key auth.
 *
 * App tools are exposed as an in-process MCP server; all built-in Claude Code
 * tools (Bash, Read, Edit, WebFetch...) are disabled.
 */
export class ClaudeAgentSdkProvider implements AgentProvider {
  readonly name = 'claude-agent-sdk' as const;
  private readonly logger = new Logger(ClaudeAgentSdkProvider.name);

  constructor(private readonly config: ClaudeAgentSdkConfig) {}

  async *run(request: AgentRunRequest): AsyncIterable<AgentEvent> {
    const abortController = this.createAbortController(request.signal);
    const toolNamesById = new Map<string, string>();
    const startedAt = Date.now();

    // Drop API key so the SDK uses the subscription login, not pay-as-you-go API billing.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const stream = query({
      prompt: request.task,
      options: {
        model: this.config.model,
        maxTurns: this.config.maxTurns,
        systemPrompt: request.systemPrompt,
        abortController,
        env,
        cwd: tmpdir(),
        tools: [],
        mcpServers: { [MCP_SERVER_NAME]: this.toMcpServer(request.tools) },
        allowedTools: request.tools.map((t) => MCP_TOOL_PREFIX + t.name),
        strictMcpConfig: true,
        settingSources: [],
        persistSession: false,
      },
    });

    try {
      for await (const message of stream) {
        yield* this.toEvents(message, toolNamesById, startedAt);
      }
    } catch (e) {
      if (abortController.signal.aborted) {
        yield { type: 'error', message: 'Agent run aborted' };
        return;
      }
      this.logger.error(`Agent run failed: ${(e as Error).message}`);
      throw new LlmProviderError(this.name, (e as Error).message);
    } finally {
      abortController.abort();
    }
  }

  private toMcpServer(tools: AgentTool[]) {
    return createSdkMcpServer({
      name: MCP_SERVER_NAME,
      tools: tools.map((t) =>
        tool(t.name, t.description, t.inputSchema, async (input) => {
          const output = await runAgentTool(t, input);
          if (output.isError) this.logger.warn(`Tool ${t.name} failed: ${output.text}`);
          return { content: [{ type: 'text', text: output.text }], isError: output.isError };
        }),
      ),
    });
  }

  private *toEvents(
    message: SDKMessage,
    toolNamesById: Map<string, string>,
    startedAt: number,
  ): Iterable<AgentEvent> {
    switch (message.type) {
      case 'assistant':
        for (const block of message.message.content) {
          if (block.type === 'text') {
            yield { type: 'text', text: block.text };
          } else if (block.type === 'tool_use') {
            const toolName = block.name.replace(MCP_TOOL_PREFIX, '');
            toolNamesById.set(block.id, toolName);
            yield { type: 'tool_call', tool: toolName, input: block.input };
          }
        }
        return;

      case 'user': {
        const content = message.message.content;
        if (typeof content === 'string') return;
        for (const block of content) {
          if (block.type === 'tool_result') {
            yield {
              type: 'tool_result',
              tool: toolNamesById.get(block.tool_use_id) ?? 'unknown',
              isError: block.is_error ?? false,
            };
          }
        }
        return;
      }

      case 'result':
        if (message.subtype === 'success') {
          yield {
            type: 'done',
            text: message.result,
            turns: message.num_turns,
            durationMs: Date.now() - startedAt,
          };
        } else {
          yield { type: 'error', message: `Agent stopped: ${message.subtype}` };
        }
        return;
    }
  }

  /** Aborts on caller's signal (client disconnect) or after the configured timeout. */
  private createAbortController(signal?: AbortSignal): AbortController {
    const controller = new AbortController();
    const signals = [AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])];
    const combined = AbortSignal.any(signals);
    // 'abort' never fires for an already-aborted signal (client gone before the run started).
    if (combined.aborted) {
      controller.abort();
    } else {
      combined.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller;
  }
}
