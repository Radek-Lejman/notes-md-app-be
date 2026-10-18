import { z } from 'zod';
import { OllamaAgentProvider } from './ollama-agent.provider';
import { OllamaChatRequest, OllamaClient } from './ollama.client';
import { OllamaChatResponse, OllamaMessage, OllamaToolCall } from './ollama.types';
import { defineAgentTool } from '../../types/agent.types';
import { collect } from '../../testing/ai-test.utils';

const reply = (content: string, toolCalls?: OllamaToolCall[]): OllamaChatResponse => ({
  model: 'qwen',
  done: true,
  message: { role: 'assistant', content, tool_calls: toolCalls },
});

const call = (name: string, args: Record<string, unknown> = {}): OllamaToolCall => ({
  function: { name, arguments: args },
});

describe('OllamaAgentProvider', () => {
  const chat = jest.fn<Promise<OllamaChatResponse>, [OllamaChatRequest]>();
  const client = { chat } as unknown as OllamaClient;

  const getNote = jest.fn();
  const tools = [
    defineAgentTool({
      name: 'get_note',
      description: 'Get note',
      inputSchema: { id: z.string() },
      handler: getNote,
    }),
  ];

  // chat() receives the same (mutated) messages array on every call — snapshot it per call.
  const messagesPerCall: OllamaMessage[][] = [];

  beforeEach(() => {
    chat.mockReset().mockImplementation(({ messages }) => {
      messagesPerCall.push([...messages]);
      return Promise.resolve(reply('done'));
    });
    messagesPerCall.length = 0;
    getNote.mockReset().mockResolvedValue({ id: 'n1', title: 'T' });
  });

  const run = (overrides: Partial<Parameters<OllamaAgentProvider['run']>[0]> = {}, maxTurns = 5) =>
    collect(new OllamaAgentProvider(client, maxTurns).run({ task: 'task', tools, ...overrides }));

  const queueReplies = (...replies: OllamaChatResponse[]) => {
    for (const r of replies) {
      chat.mockImplementationOnce(({ messages }) => {
        messagesPerCall.push([...messages]);
        return Promise.resolve(r);
      });
    }
  };

  it('converts tools to Ollama function format', async () => {
    await run();

    const [{ tools: sent }] = chat.mock.calls[0];
    expect(sent).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_note',
          description: 'Get note',
          parameters: expect.objectContaining({ type: 'object', required: ['id'] }) as object,
        },
      },
    ]);
    expect(sent?.[0].function.parameters).not.toHaveProperty('$schema');
  });

  it('starts with system + user messages when a system prompt is given', async () => {
    await run({ systemPrompt: 'sys' });
    expect(messagesPerCall[0]).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
    ]);
  });

  it('starts with the user message only without a system prompt', async () => {
    await run();
    expect(messagesPerCall[0]).toEqual([{ role: 'user', content: 'task' }]);
  });

  it('finishes in one turn when the model answers without tool_calls', async () => {
    queueReplies(reply('answer'));
    expect(await run()).toEqual([
      { type: 'text', text: 'answer' },
      { type: 'done', text: 'answer', turns: 1, durationMs: expect.any(Number) as number },
    ]);
  });

  it('finishes when tool_calls is an empty array', async () => {
    queueReplies(reply('answer', []));
    const events = await run();
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('runs a tool, feeds the result back and finishes', async () => {
    queueReplies(reply('', [call('get_note', { id: 'n1' })]), reply('final'));

    const events = await run();

    expect(events).toEqual([
      { type: 'tool_call', tool: 'get_note', input: { id: 'n1' } },
      { type: 'tool_result', tool: 'get_note', isError: false },
      { type: 'text', text: 'final' },
      { type: 'done', text: 'final', turns: 2, durationMs: expect.any(Number) as number },
    ]);
    expect(getNote).toHaveBeenCalledWith({ id: 'n1' });
    expect(messagesPerCall[1].slice(-2)).toEqual([
      { role: 'assistant', content: '', tool_calls: [call('get_note', { id: 'n1' })] },
      { role: 'tool', tool_name: 'get_note', content: '{"id":"n1","title":"T"}' },
    ]);
  });

  it('emits assistant text that accompanies tool_calls before the tool call', async () => {
    queueReplies(reply('Let me check', [call('get_note', { id: 'n1' })]), reply('final'));
    const events = await run();
    expect(events.slice(0, 2).map((e) => e.type)).toEqual(['text', 'tool_call']);
    expect(events[0]).toEqual({ type: 'text', text: 'Let me check' });
  });

  it('runs multiple tool calls of one turn sequentially, in order', async () => {
    queueReplies(
      reply('', [call('get_note', { id: 'a' }), call('get_note', { id: 'b' })]),
      reply('final'),
    );

    const events = await run();

    expect(events.slice(0, 4)).toEqual([
      { type: 'tool_call', tool: 'get_note', input: { id: 'a' } },
      { type: 'tool_result', tool: 'get_note', isError: false },
      { type: 'tool_call', tool: 'get_note', input: { id: 'b' } },
      { type: 'tool_result', tool: 'get_note', isError: false },
    ]);
    expect(getNote.mock.calls).toEqual([[{ id: 'a' }], [{ id: 'b' }]]);
  });

  it('reports an unknown tool to the model and continues', async () => {
    queueReplies(reply('', [call('rm_rf')]), reply('final'));

    const events = await run();

    expect(events[1]).toEqual({ type: 'tool_result', tool: 'rm_rf', isError: true });
    expect(messagesPerCall[1].at(-1)).toEqual({
      role: 'tool',
      tool_name: 'rm_rf',
      content: 'Unknown tool',
    });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('reports a failing tool to the model and continues', async () => {
    getNote.mockRejectedValue(new Error('Note n1 not found'));
    queueReplies(reply('', [call('get_note', { id: 'n1' })]), reply('final'));

    const events = await run();

    expect(events[1]).toEqual({ type: 'tool_result', tool: 'get_note', isError: true });
    expect(messagesPerCall[1].at(-1)?.content).toBe('Note n1 not found');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('stops with an error after maxTurns', async () => {
    chat.mockResolvedValue(reply('', [call('get_note', { id: 'n1' })]));

    const events = await run({}, 2);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Agent stopped: error_max_turns' });
  });

  it('passes the abort signal to every chat call', async () => {
    const signal = new AbortController().signal;
    queueReplies(reply('', [call('get_note', { id: 'n1' })]), reply('final'));

    await run({ signal });

    expect(chat.mock.calls.map(([req]) => req.signal)).toEqual([signal, signal]);
  });

  it('propagates client errors', async () => {
    chat.mockRejectedValue(new Error('down'));
    await expect(run()).rejects.toThrow('down');
  });

  it('sends an empty tool list when no tools are given', async () => {
    await run({ tools: [] });
    expect(chat.mock.calls[0][0].tools).toEqual([]);
  });
});
