import { Logger } from '@nestjs/common';
import { EmbeddingProvider, LlmProviderError, LlmProviderUnavailableError } from '@ai';
import { RagIndexerService } from './ragIndexer.service';
import { RagRepository } from './rag.repository';
import { AiModuleConfig } from '../config/aiModule.config';
import { NoteToIndex } from './rag.types';

describe('RagIndexerService', () => {
  const embed = jest.fn<Promise<number[][]>, [string[]]>();
  const repository = {
    findNotesToIndex: jest.fn<Promise<NoteToIndex[]>, [number, Date, string[]]>(),
    replaceChunks: jest.fn(),
    invalidateOtherModels: jest.fn(),
  };
  const config = {
    rag: {
      enabled: true,
      chunkSize: 1500,
      chunkOverlap: 100,
      indexBatchSize: 10,
      indexDebounceMs: 5000,
      indexIntervalMs: 30000,
    },
  } as AiModuleConfig;
  const makeService = () =>
    new RagIndexerService(
      config,
      { model: 'bge-m3', embed } as unknown as EmbeddingProvider,
      repository as unknown as RagRepository,
    );
  let service: RagIndexerService;
  const note: NoteToIndex = {
    id: 'n1',
    userId: 'user-1',
    title: 'Ops',
    content: '# Deploy\nrun it\n# Backup\nnightly',
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    embed.mockImplementation((texts) => Promise.resolve(texts.map((_, i) => [i, 1])));
    service = makeService();
  });

  afterEach(() => jest.restoreAllMocks());

  it('embeds the chunks of stale notes and stores them', async () => {
    repository.findNotesToIndex.mockResolvedValue([note]);

    await expect(service.indexPending()).resolves.toBe(1);

    const [limit, editedBefore] = repository.findNotesToIndex.mock.calls[0];
    expect(limit).toBe(10);
    expect(Date.now() - editedBefore.getTime()).toBeGreaterThanOrEqual(5000);
    expect(embed).toHaveBeenCalledWith([
      'Ops > Deploy\n\n# Deploy\nrun it',
      'Ops > Backup\n\n# Backup\nnightly',
    ]);
    expect(repository.replaceChunks).toHaveBeenCalledWith(note, 'bge-m3', [
      { headingPath: 'Ops > Deploy', content: '# Deploy\nrun it', embedding: [0, 1] },
      { headingPath: 'Ops > Backup', content: '# Backup\nnightly', embedding: [1, 1] },
    ]);
  });

  it('marks empty notes as indexed without calling the embedding model', async () => {
    repository.findNotesToIndex.mockResolvedValue([{ ...note, content: '' }]);

    await service.indexPending();

    expect(embed).not.toHaveBeenCalled();
    expect(repository.replaceChunks).toHaveBeenCalledWith(expect.anything(), 'bge-m3', []);
  });

  it('stops the round without penalizing notes when the provider is unavailable', async () => {
    const other = { ...note, id: 'n2' };
    repository.findNotesToIndex.mockResolvedValue([note, other]);
    embed.mockRejectedValue(new LlmProviderUnavailableError('ollama', 'ECONNREFUSED'));

    await expect(service.indexPending()).resolves.toBe(0);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(repository.replaceChunks).not.toHaveBeenCalled();

    await service.indexPending();
    expect(repository.findNotesToIndex.mock.calls[1][2]).toEqual([]);
  });

  it('a failing note does not block the others and is retried later with backoff', async () => {
    const other = { ...note, id: 'n2' };
    repository.findNotesToIndex.mockResolvedValue([note, other]);
    embed
      .mockRejectedValueOnce(new LlmProviderError('ollama', 'embed HTTP 500'))
      .mockImplementation((texts) => Promise.resolve(texts.map(() => [1, 1])));

    await expect(service.indexPending()).resolves.toBe(1);
    expect(repository.replaceChunks).toHaveBeenCalledWith(other, 'bge-m3', expect.any(Array));

    // Next round skips the failed note until its retry time.
    repository.findNotesToIndex.mockResolvedValue([]);
    await service.indexPending();
    expect(repository.findNotesToIndex.mock.calls[1][2]).toEqual(['n1']);
  });

  it('retries a failed note after the backoff and forgets the failure on success', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-02T00:00:00Z'), doNotFake: ['nextTick'] });
    try {
      repository.findNotesToIndex.mockResolvedValue([note]);
      repository.replaceChunks.mockRejectedValueOnce(new Error('db error'));
      await service.indexPending();

      jest.setSystemTime(Date.now() + 61_000);
      repository.replaceChunks.mockResolvedValue(undefined);
      await expect(service.indexPending()).resolves.toBe(1);
      expect(repository.findNotesToIndex.mock.calls[1][2]).toEqual([]);

      await service.indexPending();
      expect(repository.findNotesToIndex.mock.calls[2][2]).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});
