import { NotesTreeService } from './notesTree.service';
import { NotesService } from './notes.service';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';

describe('NotesTreeService default fields', () => {
  const getNoteById = jest.fn<Promise<unknown>, Parameters<NotesService['getNoteById']>>();
  const getNoteByParentId = jest.fn<
    Promise<unknown>,
    Parameters<NotesService['getNoteByParentId']>
  >();
  const service = new NotesTreeService({
    getNoteById,
    getNoteByParentId,
  } as unknown as NotesService);

  const query = (overrides: Partial<GetNoteQueryDto> = {}) =>
    Object.assign(new GetNoteQueryDto(), { depth: 1, ...overrides });

  beforeEach(() => {
    getNoteById.mockReset().mockResolvedValue({ id: 'root', parentId: null, title: 'Root' });
    getNoteByParentId.mockReset().mockResolvedValue([]);
  });

  it('loads the requested note with its markdown content', async () => {
    await service.getNoteWithFamily('root', query(), 'u1');
    expect(getNoteById.mock.calls[0][1]).toMatchObject({ content: true, title: true });
  });

  it('lists children without their content', async () => {
    await service.getNoteWithFamily('root', query(), 'u1');

    const childrenSelector = getNoteByParentId.mock.calls[0][1];
    expect(childrenSelector).toMatchObject({ id: true, title: true, parentId: true });
    expect(childrenSelector).not.toHaveProperty('content');
  });

  it('still returns children content when explicitly requested', async () => {
    await service.getNoteWithFamily('root', query({ 'children.fields': 'title,content' }), 'u1');
    expect(getNoteByParentId.mock.calls[0][1]).toMatchObject({ content: true });
  });
});
