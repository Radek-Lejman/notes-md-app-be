import { NotesSearchService } from './notesSerach.service';
import { NotesService } from './notes.service';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';

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
});
