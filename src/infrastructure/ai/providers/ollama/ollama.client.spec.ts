import { OllamaClient } from './ollama.client';
import { OllamaConfig } from '../../config/ai.config';
import { LlmProviderError } from '../../errors/llm-provider.error';

const config: OllamaConfig = {
  baseUrl: 'http://ollama:11434',
  model: 'qwen',
  timeoutMs: 1000,
  maxTurns: 5,
};

const okResponse = (content: string | undefined) => ({
  ok: true,
  json: () =>
    Promise.resolve({ model: 'qwen', done: true, message: { role: 'assistant', content } }),
});

describe('OllamaClient', () => {
  const fetchMock = jest.fn<Promise<Partial<Response>>, Parameters<typeof fetch>>();
  const messages = [{ role: 'user' as const, content: 'hi' }];
  const tool = {
    type: 'function' as const,
    function: { name: 't', description: 'd', parameters: {} },
  };

  const lastInit = () => fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  const lastBody = () => JSON.parse(lastInit().body as string) as Record<string, unknown>;

  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(okResponse('answer'));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('exposes the default model', () => {
    expect(new OllamaClient(config).defaultModel).toBe('qwen');
  });

  it('POSTs a non-streaming chat request to /api/chat', async () => {
    await new OllamaClient(config).chat({ messages });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ollama:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(lastBody()).toEqual({ model: 'qwen', messages, stream: false });
  });

  it('uses the model from the request when given', async () => {
    await new OllamaClient(config).chat({ messages, model: 'llama' });
    expect(lastBody().model).toBe('llama');
  });

  it('omits tools when undefined or empty', async () => {
    const client = new OllamaClient(config);

    await client.chat({ messages });
    expect(lastBody()).not.toHaveProperty('tools');

    await client.chat({ messages, tools: [] });
    expect(lastBody()).not.toHaveProperty('tools');
  });

  it('sends tools when present', async () => {
    await new OllamaClient(config).chat({ messages, tools: [tool] });
    expect(lastBody().tools).toEqual([tool]);
  });

  it('omits think when unset and sends it when configured', async () => {
    await new OllamaClient(config).chat({ messages });
    expect(lastBody()).not.toHaveProperty('think');

    await new OllamaClient({ ...config, think: false }).chat({ messages });
    expect(lastBody().think).toBe(false);
  });

  it('propagates the caller abort signal to fetch', async () => {
    const controller = new AbortController();
    await new OllamaClient(config).chat({ messages, signal: controller.signal });

    const signal = lastInit().signal!;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('passes a (timeout) signal even without a caller signal', async () => {
    await new OllamaClient(config).chat({ messages });
    expect(lastInit().signal).toBeInstanceOf(AbortSignal);
  });

  it('wraps network errors in LlmProviderError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const promise = new OllamaClient(config).chat({ messages });
    await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
    await expect(promise).rejects.toThrow('fetch failed');
  });

  it('wraps non-2xx responses with status and body', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });

    await expect(new OllamaClient(config).chat({ messages })).rejects.toThrow('HTTP 500: boom');
  });

  it('wraps body read errors (e.g. timeout, invalid JSON) in LlmProviderError', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    const promise = new OllamaClient(config).chat({ messages });
    await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
    await expect(promise).rejects.toThrow('Unexpected token');
  });

  it('rejects a response without message', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'model not found' }),
    });

    const promise = new OllamaClient(config).chat({ messages });
    await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
    await expect(promise).rejects.toThrow('response without message');
  });

  it.each([
    ['reasoning</think>\n\nanswer', 'answer'],
    ['a</think>b</think>  final ', 'final'],
    ['  plain answer  ', 'plain answer'],
    [undefined, ''],
  ])('normalizes content %j -> %j', async (raw, expected) => {
    fetchMock.mockResolvedValue(okResponse(raw));
    const response = await new OllamaClient(config).chat({ messages });
    expect(response.message.content).toBe(expected);
  });
});
