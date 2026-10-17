import { z } from 'zod';
import { UserNotesService } from 'src/modules/notes/service/userNotes.service';
import { NoteSearchResult } from 'src/modules/notes/interfaces/notes.interface';
import { SearchNotesQueryDto } from 'src/modules/notes/dto/searchNotesQueryDto';
import { AGENT_SEARCH_LIMIT } from '../consts/ai.consts';
import {
  createKeywordSearchTool,
  KEYWORD_SEARCH_PROMPT,
  KeywordSearchHit,
  MAX_KEYWORDS,
} from './keywordSearch.tool';
import { createNotesTools } from './notes.tools';

describe('keyword search tool', () => {
  const searchByText = jest.fn<Promise<NoteSearchResult[]>, [string, SearchNotesQueryDto]>();
  const notes = { searchByText } as unknown as UserNotesService;
  const tool = createKeywordSearchTool(notes, 'user-1');
  const search = (keywords: string[]) => tool.handler({ keywords }) as Promise<KeywordSearchHit[]>;

  const note = (id: string, day: number, snippet = `snippet ${id}`): NoteSearchResult => ({
    id,
    title: id.toUpperCase(),
    updatedAt: new Date(2026, 0, day),
    snippet,
  });

  /** Notes found per keyword. */
  const index = (byKeyword: Record<string, NoteSearchResult[]>) =>
    searchByText.mockImplementation((_user, dto) => Promise.resolve(byKeyword[dto.q] ?? []));

  beforeEach(() => searchByText.mockReset().mockResolvedValue([]));

  it('replaces search_notes in createNotesTools only when enabled', () => {
    const schemaOf = (keywordSearch: boolean) =>
      Object.keys(
        createNotesTools(notes, 'user-1', { keywordSearch }).find((t) => t.name === 'search_notes')!
          .inputSchema,
      );

    expect(schemaOf(true)).toEqual(['keywords']);
    expect(schemaOf(false)).toEqual(['query']);
  });

  it('runs one title-only query per keyword, bound to the user', async () => {
    await search(['wakac', 'morze']);

    expect(searchByText).toHaveBeenCalledTimes(2);
    for (const q of ['wakac', 'morze']) {
      expect(searchByText).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ q, limit: AGENT_SEARCH_LIMIT, fields: 'title,updatedAt' }),
      );
    }
  });

  it('skips duplicate keywords regardless of case', async () => {
    await search(['Wakac', 'wakac', 'WAKAC']);
    expect(searchByText).toHaveBeenCalledTimes(1);
  });

  it('ranks notes by matched keywords, then by the latest update', async () => {
    index({
      wakac: [note('old-both', 1), note('new-one', 9)],
      morze: [note('old-both', 1, 'other snippet'), note('mid-one', 5)],
    });

    await expect(search(['wakac', 'morze'])).resolves.toEqual([
      { ...note('old-both', 1), matched: ['wakac', 'morze'] },
      { ...note('new-one', 9), matched: ['wakac'] },
      { ...note('mid-one', 5), matched: ['morze'] },
    ]);
  });

  it('returns at most AGENT_SEARCH_LIMIT notes', async () => {
    index({
      a1: Array.from({ length: AGENT_SEARCH_LIMIT }, (_, i) => note(`a${i}`, i + 1)),
      b1: Array.from({ length: AGENT_SEARCH_LIMIT }, (_, i) => note(`b${i}`, i + 1)),
    });

    expect(await search(['a1', 'b1'])).toHaveLength(AGENT_SEARCH_LIMIT);
  });

  it('falls back to an empty title for a note without one', async () => {
    index({ ab: [{ ...note('n1', 1), title: undefined }] });
    expect((await search(['ab']))[0].title).toBe('');
  });

  it.each([
    ['no keywords', []],
    ['a one-letter keyword', ['a']],
    ['too many keywords', Array.from({ length: MAX_KEYWORDS + 1 }, (_, i) => `k${i}`)],
  ])('rejects %s', (_case, keywords) => {
    expect(z.object(tool.inputSchema).safeParse({ keywords }).success).toBe(false);
  });

  it('tells the model to use short stems and fall back to synonyms and list_notes', () => {
    expect(KEYWORD_SEARCH_PROMPT).toMatch(/keywords/);
    expect(KEYWORD_SEARCH_PROMPT).toMatch(/list_notes/);
  });
});
