import { Logger } from '@nestjs/common';
import { EmbeddingProvider, LlmProviderError, LlmProviderUnavailableError } from '@ai';
import { DRAIN_DELAY_MS, RagIndexerService } from './ragIndexer.service';
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

  it('skips a round while the previous one is still running', async () => {
    let finish: (notes: NoteToIndex[]) => void = () => undefined;
    repository.findNotesToIndex.mockReturnValueOnce(
      new Promise<NoteToIndex[]>((resolve) => (finish = resolve)),
    );

    const first = service.indexPending();
    await expect(service.indexPending()).resolves.toBe(0);
    expect(repository.findNotesToIndex).toHaveBeenCalledTimes(1);

    finish([]);
    await expect(first).resolves.toBe(0);
  });

  it('logs a paused provider once and the recovery once', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    repository.findNotesToIndex.mockRejectedValue(new Error('ECONNREFUSED'));

    await service.indexPending();
    await service.indexPending();
    expect(warn).toHaveBeenCalledTimes(1);

    repository.findNotesToIndex.mockResolvedValue([]);
    await service.indexPending();
    await service.indexPending();
    expect(log.mock.calls.filter(([m]) => m === 'RAG indexing recovered')).toHaveLength(1);
  });

  it('embeds large notes in batches of 32 chunks', async () => {
    const sections = Array.from({ length: 40 }, (_, i) => `# S${i}\ntext ${i}`).join('\n');
    repository.findNotesToIndex.mockResolvedValue([{ ...note, content: sections }]);

    await service.indexPending();

    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([32, 8]);
    const [, , chunks] = repository.replaceChunks.mock.calls[0] as [unknown, unknown, unknown[]];
    expect(chunks).toHaveLength(40);
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick'] });
      repository.findNotesToIndex.mockResolvedValue([]);
      repository.invalidateOtherModels.mockResolvedValue(0);
    });

    afterEach(() => {
      service.onModuleDestroy();
      jest.useRealTimers();
    });

    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    it('does nothing when RAG is disabled', async () => {
      const disabled = new RagIndexerService(
        { rag: { ...config.rag, enabled: false } } as AiModuleConfig,
        { model: 'bge-m3', embed } as unknown as EmbeddingProvider,
        repository as unknown as RagRepository,
      );

      await disabled.onModuleInit();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(repository.invalidateOtherModels).not.toHaveBeenCalled();
      expect(repository.findNotesToIndex).not.toHaveBeenCalled();
    });

    it('re-indexes notes of another embedding model, then indexes on an interval', async () => {
      repository.invalidateOtherModels.mockResolvedValue(3);

      await service.onModuleInit();
      expect(repository.invalidateOtherModels).toHaveBeenCalledWith('bge-m3');
      expect(repository.findNotesToIndex).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1_000);
      await flush();
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30_000);
      await flush();
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(2);
    });

    it('still starts indexing when the start-up invalidation fails', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      repository.invalidateOtherModels.mockRejectedValue(new Error('relation does not exist'));

      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1_000);

      expect(error).toHaveBeenCalledWith('RAG init failed: relation does not exist');
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(1);
    });

    const fullBatch = () =>
      Array.from({ length: config.rag.indexBatchSize }, (_, i) => ({ ...note, id: `n${i}` }));

    it('starts the next round right away after a full batch (drain)', async () => {
      repository.findNotesToIndex.mockResolvedValueOnce(fullBatch());

      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(DRAIN_DELAY_MS);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(2);

      // The second round was partial: back to the normal interval.
      await jest.advanceTimersByTimeAsync(DRAIN_DELAY_MS);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(3);
    });

    it('keeps draining when a note of the full batch fails', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      repository.findNotesToIndex.mockResolvedValueOnce(fullBatch());
      repository.replaceChunks.mockRejectedValueOnce(new Error('bad note'));

      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1_000 + DRAIN_DELAY_MS);

      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(2);
    });

    it('waits the normal interval when the provider is unavailable', async () => {
      repository.findNotesToIndex.mockResolvedValueOnce(fullBatch());
      embed.mockRejectedValue(new LlmProviderUnavailableError('ollama', 'ECONNREFUSED'));

      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1_000 + DRAIN_DELAY_MS);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(2);
    });

    it('does not drain after module destroy', async () => {
      repository.findNotesToIndex.mockResolvedValue(fullBatch());

      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1_000);
      service.onModuleDestroy();

      await jest.advanceTimersByTimeAsync(60_000);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(1);
    });

    it('stops scheduling rounds after module destroy', async () => {
      await service.onModuleInit();
      service.onModuleDestroy();

      await jest.advanceTimersByTimeAsync(120_000);
      expect(repository.findNotesToIndex).not.toHaveBeenCalled();
    });

    it('does not schedule the next round when destroyed during a running round', async () => {
      let finish: (notes: NoteToIndex[]) => void = () => undefined;
      repository.findNotesToIndex.mockReturnValueOnce(
        new Promise<NoteToIndex[]>((resolve) => (finish = resolve)),
      );

      await service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1_000);
      service.onModuleDestroy();
      finish([]);
      await flush();

      await jest.advanceTimersByTimeAsync(120_000);
      expect(repository.findNotesToIndex).toHaveBeenCalledTimes(1);
    });
  });
});
