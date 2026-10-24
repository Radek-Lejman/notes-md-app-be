import { NotesSearchService } from './notesSerach.service';
import { NotesService } from './notes.service';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';
import { encodeCursor } from '../utils/searchCursorPayload';

describe('NotesSearchService', () => {
  const getNoteByText = jest.fn<Promise<unknown>, Parameters<NotesService['getNoteByText']>>();
  const service = new NotesSearchService({ getNoteByText } as unknown as NotesService);

  const search = (fields: string, q = 'docker') =>
    service.searchByText('u1', Object.assign(new SearchNotesQueryDto(), { q, fields, limit: 20 }));

  beforeEach(() => {
    getNoteByText
      .mockReset()
      .mockResolvedValue([
        { id: 'n1', title: 'Docker', content: '# Docker\n\n**Kontenery** i obrazy.' },
      ]);
  });

  it('always loads content to build the snippet', async () => {
    await search('title');
    expect(getNoteByText.mock.calls[0][1]).toMatchObject({ title: true, content: true });
  });

  it('returns a plain-text snippet instead of the content by default', async () => {
    await expect(search('title')).resolves.toEqual([
      { id: 'n1', title: 'Docker', snippet: 'Docker Kontenery i obrazy.' },
    ]);
  });

  it('returns the content too when it was requested', async () => {
    const [hit] = await search('title,content');
    expect(hit.content).toBe('# Docker\n\n**Kontenery** i obrazy.');
    expect(hit.snippet).toBe('Docker Kontenery i obrazy.');
  });

  it('skips the database for a query without searchable words', async () => {
    await expect(search('title', '!!!')).resolves.toEqual([]);
    expect(getNoteByText).not.toHaveBeenCalled();
  });

  it('returns nothing when no fields were requested', async () => {
    await expect(
      service.searchByText('u1', Object.assign(new SearchNotesQueryDto(), { q: 'docker' })),
    ).resolves.toEqual([]);
    expect(getNoteByText).not.toHaveBeenCalled();
  });

  it("searches the user's notes with a prefix query, page size and default order", async () => {
    await search('title', 'dock comp');

    const [userId, , tsq, options] = getNoteByText.mock.calls[0];
    expect(userId).toBe('u1');
    expect(tsq).toBe('dock:* & comp:*');
    expect(options).toEqual({ orderBy: { updatedAt: 'asc' }, take: 20, cursorId: undefined });
  });

  it.each([
    ['rank', 'best-first'],
    ['-rank', 'worst-first'],
  ] as const)('ranks %s in the database (%s), without a Prisma sort', async (order, rank) => {
    await service.searchByText(
      'u1',
      Object.assign(new SearchNotesQueryDto(), { q: 'docker', fields: 'title', limit: 5, order }),
    );
    expect(getNoteByText.mock.calls[0][3]).toEqual({
      orderBy: undefined,
      take: 5,
      rank,
      cursorId: undefined,
    });
  });

  it('continues from a valid cursor and ignores a malformed one', async () => {
    const cursor = encodeCursor({ id: 'n9', order: '-updatedAt' });
    const withCursor = (c: string) =>
      service.searchByText(
        'u1',
        Object.assign(new SearchNotesQueryDto(), { q: 'docker', fields: 'title', cursor: c }),
      );

    await withCursor(cursor);
    await withCursor('%%%');
    expect(getNoteByText.mock.calls.map(([, , , o]) => o.cursorId)).toEqual(['n9', undefined]);
  });

  it('builds a snippet from an empty note', async () => {
    getNoteByText.mockResolvedValue([{ id: 'n1', title: 'Empty', content: undefined }]);
    await expect(search('title')).resolves.toEqual([{ id: 'n1', title: 'Empty', snippet: '' }]);
  });
});
