import { OllamaEmbeddingProvider } from './ollama-embedding.provider';
import { LlmProviderError, LlmProviderUnavailableError } from '../../errors/llm-provider.error';

describe('OllamaEmbeddingProvider', () => {
  const provider = new OllamaEmbeddingProvider({
    baseUrl: 'http://ollama',
    model: 'bge-m3',
    timeoutMs: 1000,
  });
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });

  it('exposes the model name', () => {
    expect(provider.model).toBe('bge-m3');
  });

  it('embeds a batch of texts with one request', async () => {
    respond(200, { embeddings: [[0.1], [0.2]] });

    await expect(provider.embed(['a', 'b'])).resolves.toEqual([[0.1], [0.2]]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ollama/api/embed');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'bge-m3', input: ['a', 'b'] });
  });

  it('skips the request for an empty batch', async () => {
    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails on HTTP errors (input-specific, not "unavailable")', async () => {
    respond(500, { error: 'input too long' });
    const error = await provider.embed(['a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error).not.toBeInstanceOf(LlmProviderUnavailableError);
  });

  it.each([404, 503])('reports HTTP %i as provider unavailable', async (status) => {
    respond(status, { error: 'model "bge-m3" not found' });
    const error = await provider.embed(['a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmProviderUnavailableError);
  });

  it('reports a timeout as an input failure, not "unavailable"', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const error = await provider.embed(['a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error).not.toBeInstanceOf(LlmProviderUnavailableError);
    expect((error as Error).message).toContain('timed out');
  });

  it('fails when the number of vectors does not match', async () => {
    respond(200, { embeddings: [[0.1]] });
    await expect(provider.embed(['a', 'b'])).rejects.toThrow('unexpected number of vectors');
  });

  it('reports network errors as provider unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const error = await provider.embed(['a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmProviderUnavailableError);
    expect((error as Error).message).toContain('ECONNREFUSED');
  });
});
