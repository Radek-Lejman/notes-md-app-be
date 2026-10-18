import { Logger } from '@nestjs/common';
import { EmbeddingProvider } from '@ai';
import { RagSearchService } from './ragSearch.service';
import { RagRepository } from './rag.repository';
import { RagHit } from './rag.types';
import { AiModuleConfig } from '../config/aiModule.config';

describe('RagSearchService', () => {
  const embed = jest.fn<Promise<number[][]>, [string[]]>();
  const search = jest.fn<Promise<RagHit[]>, [string, string, number[], number]>();
  const keywordSearch = jest.fn<Promise<RagHit[]>, [string, string, string, number]>();
  const stats = jest.fn();
  const makeService = (enabled = true, hybrid = false) =>
    new RagSearchService(
      { rag: { enabled, topK: 5, minScore: 0.5, hybrid } } as AiModuleConfig,
      { model: 'bge-m3', embed } as unknown as EmbeddingProvider,
      { search, keywordSearch, stats } as unknown as RagRepository,
    );
  const hit = (score: number) => ({
    noteId: 'n',
    title: 't',
    headingPath: 't',
    content: 'c',
    score,
  });

  beforeEach(() => {
    embed.mockReset().mockResolvedValue([[0.1, 0.2]]);
    search.mockReset().mockResolvedValue([hit(0.9), hit(0.4)]);
    keywordSearch.mockReset().mockResolvedValue([]);
  });

  it("embeds the query and searches the user's chunks of the current model", async () => {
    await expect(makeService().search('user-1', 'deploy')).resolves.toEqual([hit(0.9)]);
    expect(embed).toHaveBeenCalledWith(['deploy'], undefined, 'query');
    expect(search).toHaveBeenCalledWith('user-1', 'bge-m3', [0.1, 0.2], 5);
  });

  it('returns nothing when disabled or for an empty query', async () => {
    await expect(makeService(false).search('user-1', 'deploy')).resolves.toEqual([]);
    await expect(makeService().search('user-1', '  ')).resolves.toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it('searchSafe swallows embedding errors', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    embed.mockRejectedValue(new Error('ollama down'));
    await expect(makeService().searchSafe('user-1', 'deploy')).resolves.toEqual([]);
  });

  it('exposes the embedding model and whether RAG is enabled', () => {
    expect(makeService().model).toBe('bge-m3');
    expect(makeService().enabled).toBe(true);
    expect(makeService(false).enabled).toBe(false);
  });

  it('uses the configured topK by default and an explicit limit when given', async () => {
    await makeService().search('user-1', 'deploy');
    await makeService().searchSafe('user-1', 'deploy', 2);
    expect(search.mock.calls.map((call) => call[3])).toEqual([5, 2]);
  });

  it("stats are counted for the user's chunks of the current model", async () => {
    stats.mockResolvedValue({ totalNotes: 1, indexedNotes: 1, chunks: 2 });
    await expect(makeService().stats('user-1')).resolves.toEqual({
      totalNotes: 1,
      indexedNotes: 1,
      chunks: 2,
    });
    expect(stats).toHaveBeenCalledWith('user-1', 'bge-m3');
  });

  describe('hybrid (RAG_HYBRID)', () => {
    const chunk = (noteId: string, score: number) => ({
      noteId,
      title: noteId,
      headingPath: noteId,
      content: `text of ${noteId}`,
      score,
    });

    it('fuses semantic hits above RAG_MIN_SCORE with keyword hits of the question', async () => {
      search.mockResolvedValue([chunk('a', 0.9), chunk('b', 0.8), chunk('weak', 0.3)]);
      keywordSearch.mockResolvedValue([chunk('b', 0.1), chunk('c', 0.05)]);

      const hits = await makeService(true, true).search('user-1', 'gdzie na wakacje?');

      expect(keywordSearch).toHaveBeenCalledWith('user-1', 'bge-m3', 'gdzie:* | wakacje:*', 5);
      expect(hits.map((hit) => hit.noteId)).toEqual(['b', 'a', 'c']);
    });

    it('stays semantic-only when the question has no usable keywords', async () => {
      search.mockResolvedValue([chunk('a', 0.9)]);
      await expect(makeService(true, true).search('user-1', 'co to?')).resolves.toEqual([
        chunk('a', 0.9),
      ]);
      expect(keywordSearch).not.toHaveBeenCalled();
    });

    it('does not run the keyword search when RAG_HYBRID is off', async () => {
      await makeService(true, false).search('user-1', 'wakacje nad morzem');
      expect(keywordSearch).not.toHaveBeenCalled();
    });
  });
});
