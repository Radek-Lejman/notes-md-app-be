import { UserNotesService } from './userNotes.service';
import { NotesService } from './notes.service';
import { NotesTreeService } from './notesTree.service';
import { NotesSearchService } from './notesSerach.service';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';

describe('UserNotesService', () => {
  const notes = { updateNote: jest.fn(), createNote: jest.fn(), getAllNotes: jest.fn() };
  const tree = { getNoteWithFamily: jest.fn() };
  const search = { searchByText: jest.fn() };
  const service = new UserNotesService(
    notes as unknown as NotesService,
    tree as unknown as NotesTreeService,
    search as unknown as NotesSearchService,
  );
  const result = { id: 'n1' };

  beforeEach(() => jest.resetAllMocks());

  it('updateNoteById passes the note id, the changes and the user', async () => {
    notes.updateNote.mockResolvedValue(result);
    await expect(service.updateNoteById('n1', { title: 'x' }, 'user-1')).resolves.toBe(result);
    expect(notes.updateNote).toHaveBeenCalledWith({ title: 'x' }, 'n1', 'user-1');
  });

  it('createNote creates the note for the user', async () => {
    notes.createNote.mockResolvedValue(result);
    const dto = { title: 't', content: '' };
    await expect(service.createNote(dto, 'user-1')).resolves.toBe(result);
    expect(notes.createNote).toHaveBeenCalledWith(dto, 'user-1');
  });

  it("getAllNotes lists the user's notes", async () => {
    notes.getAllNotes.mockResolvedValue([result]);
    await expect(service.getAllNotes('user-1')).resolves.toEqual([result]);
    expect(notes.getAllNotes).toHaveBeenCalledWith('user-1');
  });

  it('getNoteById loads the note with its family for the user', async () => {
    tree.getNoteWithFamily.mockResolvedValue(result);
    const query = new GetNoteQueryDto();
    await expect(service.getNoteById('n1', query, 'user-1')).resolves.toBe(result);
    expect(tree.getNoteWithFamily).toHaveBeenCalledWith('n1', query, 'user-1');
  });

  it("searchByText searches the user's notes", async () => {
    search.searchByText.mockResolvedValue([result]);
    const query = Object.assign(new SearchNotesQueryDto(), { q: 'docker' });
    await expect(service.searchByText('user-1', query)).resolves.toEqual([result]);
    expect(search.searchByText).toHaveBeenCalledWith('user-1', query);
  });
});
