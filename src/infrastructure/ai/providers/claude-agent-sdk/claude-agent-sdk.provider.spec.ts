import { tmpdir } from 'node:os';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAgentSdkProvider } from './claude-agent-sdk.provider';
import { ClaudeAgentSdkConfig } from '../../config/ai.config';
import { LlmProviderError } from '../../errors/llm-provider.error';
import { AgentRunRequest, defineAgentTool } from '../../types/agent.types';
import { collect, streamOf } from '../../testing/ai-test.utils';

// Typed views of the manual mocks in src/__mocks__ (only what the provider passes/reads).
interface QueryParams {
  prompt: string;
  options: {
    abortController: AbortController;
    env: Record<string, string | undefined>;
    mcpServers: Record<string, unknown>;
  };
}
type McpToolHandler = (input: unknown) => Promise<unknown>;

const queryMock = query as unknown as jest.Mock<AsyncIterable<object>, [QueryParams]>;
const toolMock = tool as unknown as jest.Mock<unknown, [string, string, unknown, McpToolHandler]>;
const createServerMock = createSdkMcpServer as unknown as jest.Mock<unknown>;

/** Async iterable whose first read waits for `signal`, then throws (like the real SDK). */
const untilAborted = (signal: AbortSignal): AsyncIterable<never> => ({
  [Symbol.asyncIterator]: () => ({
    next: async () => {
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      }
      throw new Error('Operation aborted');
    },
  }),
});

const config: ClaudeAgentSdkConfig = { model: 'sonnet', maxTurns: 4, timeoutMs: 1000 };

// --- SDK message builders (only the fields the provider reads) ---
const assistant = (...content: object[]) => ({ type: 'assistant', message: { content } });
const user = (content: string | object[]) => ({ type: 'user', message: { content } });
const success = (result: string, turns = 2) => ({
  type: 'result',
  subtype: 'success',
  result,
  num_turns: turns,
});
const toolUse = (id: string, name: string, input: object = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const toolResult = (toolUseId: string, isError?: boolean) => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  ...(isError === undefined ? {} : { is_error: isError }),
});

/** Makes query() stream the given SDK messages. */
const streamMessages = (...messages: object[]) =>
  queryMock.mockImplementation(() => streamOf(...messages));

/** Makes query() hang until its abortController fires, then throw (like the real SDK). */
const streamUntilAborted = () =>
  queryMock.mockImplementation(({ options }) => untilAborted(options.abortController.signal));

describe('ClaudeAgentSdkProvider', () => {
  const handler = jest.fn();
  const tools = [
    defineAgentTool({
      name: 'get_note',
      description: 'Get note',
      inputSchema: { id: z.string() },
      handler,
    }),
  ];
  const provider = new ClaudeAgentSdkProvider(config);
  const run = (overrides: Partial<AgentRunRequest> = {}) =>
    collect(provider.run({ task: 'task', systemPrompt: 'sys', tools, ...overrides }));
  const queryOptions = () => queryMock.mock.calls[0][0].options;

  let warnLog: jest.SpyInstance;
  let errorLog: jest.SpyInstance;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    queryMock.mockReset();
    toolMock.mockClear();
    createServerMock.mockClear();
    handler.mockReset().mockResolvedValue({ id: 'n1' });
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    streamMessages(success('ok'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  describe('query options & tools', () => {
    it('runs an isolated session with only the app tools allowed', async () => {
      await run();

      expect(queryMock.mock.calls[0][0].prompt).toBe('task');
      expect(queryOptions()).toMatchObject({
        model: 'sonnet',
        maxTurns: 4,
        systemPrompt: 'sys',
        cwd: tmpdir(),
        tools: [],
        allowedTools: ['mcp__app__get_note'],
        strictMcpConfig: true,
        settingSources: [],
        persistSession: false,
      });
      expect(queryOptions().abortController).toBeInstanceOf(AbortController);
    });

    it('does not pass ANTHROPIC_API_KEY to the SDK (subscription auth)', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-secret';
      await run();
      expect(queryOptions().env).not.toHaveProperty('ANTHROPIC_API_KEY');
    });

    it('exposes tools via an in-process MCP server named "app"', async () => {
      await run();

      expect(toolMock).toHaveBeenCalledWith(
        'get_note',
        'Get note',
        tools[0].inputSchema,
        expect.any(Function),
      );
      expect(createServerMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'app' }));
      expect(queryOptions().mcpServers.app).toEqual(createServerMock.mock.results[0].value);
    });

    it('MCP tool handler returns the tool output as text', async () => {
      await run();
      const mcpHandler = toolMock.mock.calls[0][3];

      await expect(mcpHandler({ id: 'n1' })).resolves.toEqual({
        content: [{ type: 'text', text: '{"id":"n1"}' }],
        isError: false,
      });
      expect(warnLog).not.toHaveBeenCalled();
    });

    it('MCP tool handler reports tool errors and logs a warning', async () => {
      handler.mockRejectedValue(new Error('Note n1 not found'));
      await run();
      const mcpHandler = toolMock.mock.calls[0][3];

      await expect(mcpHandler({ id: 'n1' })).resolves.toEqual({
        content: [{ type: 'text', text: 'Note n1 not found' }],
        isError: true,
      });
      expect(warnLog).toHaveBeenCalledWith(expect.stringContaining('get_note'));
    });
  });

  describe('SDK message -> AgentEvent mapping', () => {
    it('maps assistant text and tool_use blocks, ignoring other blocks', async () => {
      streamMessages(
        assistant(
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: 'Checking' },
          toolUse('tu1', 'mcp__app__get_note', { id: 'n1' }),
        ),
      );

      expect(await run()).toEqual([
        { type: 'text', text: 'Checking' },
        { type: 'tool_call', tool: 'get_note', input: { id: 'n1' } },
      ]);
    });

    it('ignores user messages with string content and non tool_result blocks', async () => {
      streamMessages(user('plain'), user([{ type: 'text', text: 'x' }]));
      expect(await run()).toEqual([]);
    });

    it('maps tool_result to the tool name of the matching tool_use', async () => {
      streamMessages(
        assistant(toolUse('tu1', 'mcp__app__get_note')),
        user([toolResult('tu1'), toolResult('tu1', true), toolResult('missing', false)]),
      );

      expect((await run()).slice(1)).toEqual([
        { type: 'tool_result', tool: 'get_note', isError: false },
        { type: 'tool_result', tool: 'get_note', isError: true },
        { type: 'tool_result', tool: 'unknown', isError: false },
      ]);
    });

    it('maps a successful result to done', async () => {
      streamMessages(success('final answer', 3));
      expect(await run()).toEqual([
        { type: 'done', text: 'final answer', turns: 3, durationMs: expect.any(Number) as number },
      ]);
    });

    it('maps an error result to an error event', async () => {
      streamMessages({ type: 'result', subtype: 'error_max_turns' });
      expect(await run()).toEqual([{ type: 'error', message: 'Agent stopped: error_max_turns' }]);
    });

    it('ignores other message types', async () => {
      streamMessages({ type: 'system', subtype: 'init' });
      expect(await run()).toEqual([]);
    });
  });

  describe('errors, abort & timeout', () => {
    it('wraps SDK failures in LlmProviderError and logs them', async () => {
      queryMock.mockImplementation(() => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('auth failed')) }),
      }));

      const promise = run();
      await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
      await expect(promise).rejects.toThrow('auth failed');
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('auth failed'));
    });

    it('yields an abort error when the caller aborts', async () => {
      streamUntilAborted();
      const controller = new AbortController();

      const events = run({ signal: controller.signal });
      controller.abort();

      expect(await events).toEqual([{ type: 'error', message: 'Agent run aborted' }]);
    });

    it('aborts immediately when the caller signal is already aborted', async () => {
      streamUntilAborted();

      const events = await run({ signal: AbortSignal.abort() });

      expect(events).toEqual([{ type: 'error', message: 'Agent run aborted' }]);
    });

    it('yields an abort error on timeout (no caller signal)', async () => {
      streamUntilAborted();
      const fast = new ClaudeAgentSdkProvider({ ...config, timeoutMs: 20 });

      const events = await collect(fast.run({ task: 'task', tools }));

      expect(events).toEqual([{ type: 'error', message: 'Agent run aborted' }]);
    });

    it('aborts the SDK session after a normal finish (cleanup)', async () => {
      await run();
      expect(queryOptions().abortController.signal.aborted).toBe(true);
    });
  });
});
