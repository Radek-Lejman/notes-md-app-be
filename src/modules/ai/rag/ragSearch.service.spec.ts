import { Logger } from '@nestjs/common';
import { EmbeddingProvider } from '@ai';
import { RagSearchService } from './ragSearch.service';
import { RagRepository } from './rag.repository';
import { RagHit } from './rag.types';
import { AiModuleConfig } from '../config/aiModule.config';

describe('RagSearchService', () => {
  const embed = jest.fn<Promise<number[][]>, [string[]]>();
  const search = jest.fn<Promise<RagHit[]>, [string, string, number[], number]>();
  const makeService = (enabled = true) =>
    new RagSearchService(
      { rag: { enabled, topK: 5, minScore: 0.5 } } as AiModuleConfig,
      { model: 'bge-m3', embed } as unknown as EmbeddingProvider,
      { search } as unknown as RagRepository,
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
  });

  it("embeds the query and searches the user's chunks of the current model", async () => {
    await expect(makeService().search('user-1', 'deploy')).resolves.toEqual([hit(0.9)]);
    expect(embed).toHaveBeenCalledWith(['deploy']);
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
});
