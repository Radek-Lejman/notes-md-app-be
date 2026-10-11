import { AgentEvent, AgentProvider, AgentRunRequest, AgentTool } from '../../types/agent.types';
import { runAgentTool, toolInputJsonSchema } from '../../tools/run-agent-tool';
import { OllamaClient } from './ollama.client';
import { OllamaMessage, OllamaTool } from './ollama.types';

/**
 * Agent loop for local Ollama models with tool calling (e.g. qwen3, llama3.2).
 * Ollama only returns tool_calls — the loop (execute tool -> send result -> ask again)
 * is implemented here.
 */
export class OllamaAgentProvider implements AgentProvider {
  readonly name = 'ollama' as const;
  readonly usesAccountAuth = false;

  constructor(
    private readonly client: OllamaClient,
    private readonly maxTurns: number,
  ) {}

  async *run(request: AgentRunRequest): AsyncIterable<AgentEvent> {
    const startedAt = Date.now();
    const toolsByName = new Map(request.tools.map((t) => [t.name, t]));
    const tools = request.tools.map((t) => this.toOllamaTool(t));

    const messages: OllamaMessage[] = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.task });

    for (let turn = 1; turn <= this.maxTurns; turn++) {
      const { message } = await this.client.chat({ messages, tools, signal: request.signal });
      messages.push(message);

      const toolCalls = message.tool_calls ?? [];
      if (!toolCalls.length) {
        yield { type: 'text', text: message.content };
        yield {
          type: 'done',
          text: message.content,
          turns: turn,
          durationMs: Date.now() - startedAt,
        };
        return;
      }

      if (message.content) yield { type: 'text', text: message.content };

      for (const call of toolCalls) {
        const { name, arguments: input } = call.function;
        yield { type: 'tool_call', tool: name, input };

        const output = await runAgentTool(toolsByName.get(name), input);
        yield { type: 'tool_result', tool: name, isError: output.isError };

        messages.push({ role: 'tool', tool_name: name, content: output.text });
      }
    }

    yield { type: 'error', message: 'Agent stopped: error_max_turns' };
  }

  private toOllamaTool(tool: AgentTool): OllamaTool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toolInputJsonSchema(tool),
      },
    };
  }
}
