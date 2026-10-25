import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { AuthUser } from '@security';
import { NotesController } from './notes.controller';
import { UserNotesService } from '../service/userNotes.service';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';
import { NotesImportService } from '../service/notesImport.service';
import { ImportNotesDto } from '../dto/importNotes.dto';

describe('NotesController', () => {
  const notes = {
    getAllNotes: jest.fn(),
    createNote: jest.fn(),
    searchByText: jest.fn(),
    getNoteById: jest.fn(),
    updateNoteById: jest.fn(),
  };
  const notesImport = { importNotes: jest.fn() };
  const controller = new NotesController(
    notes as unknown as UserNotesService,
    notesImport as unknown as NotesImportService,
  );
  const user = { sub: 'user-1' } as AuthUser;
  const note = { id: 'n1', title: 'Docker' };

  const getQuery = (overrides: Partial<GetNoteQueryDto> = {}) =>
    Object.assign(new GetNoteQueryDto(), overrides);
  const searchQuery = (overrides: Partial<SearchNotesQueryDto> = {}) =>
    Object.assign(new SearchNotesQueryDto(), { q: 'docker', fields: 'title' }, overrides);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it("getAll lists the current user's notes", async () => {
    notes.getAllNotes.mockResolvedValue([note]);
    await expect(controller.getAll(user)).resolves.toEqual([note]);
    expect(notes.getAllNotes).toHaveBeenCalledWith('user-1');
  });

  it('createNote creates the note for the current user', async () => {
    notes.createNote.mockResolvedValue(note);
    const dto = { title: 'Docker', content: '' };
    await expect(controller.createNote(dto, user)).resolves.toBe(note);
    expect(notes.createNote).toHaveBeenCalledWith(dto, 'user-1');
  });

  describe('search', () => {
    it("searches the current user's notes", async () => {
      notes.searchByText.mockResolvedValue([note]);
      const query = searchQuery();

      await expect(controller.search(user, query)).resolves.toEqual([note]);
      expect(notes.searchByText).toHaveBeenCalledWith('user-1', query);
    });

    it.each(['', '   '])('rejects a blank query %j with 400', async (q) => {
      await expect(controller.search(user, searchQuery({ q }))).rejects.toThrow(
        new BadRequestException('Query "q" is required'),
      );
      expect(notes.searchByText).not.toHaveBeenCalled();
    });

    it('rejects fields that may not be requested (e.g. id, password) with 400', async () => {
      await expect(
        controller.search(user, searchQuery({ fields: 'title,password' })),
      ).rejects.toThrow('Forbidden field "password"');
      expect(notes.searchByText).not.toHaveBeenCalled();
    });
  });

  describe('getNoteById', () => {
    it("returns the current user's note with its family", async () => {
      notes.getNoteById.mockResolvedValue(note);
      const query = getQuery({ depth: 2 });

      await expect(controller.getNoteById('n1', user, query)).resolves.toBe(note);
      expect(notes.getNoteById).toHaveBeenCalledWith('n1', query, 'user-1');
    });

    it('answers 404 for a missing note or a note of another user', async () => {
      notes.getNoteById.mockResolvedValue(null);
      await expect(controller.getNoteById('n1', user, getQuery())).rejects.toThrow(
        new NotFoundException('Note n1 not found'),
      );
    });

    it.each([
      ['fields', { fields: 'title,secret' }],
      ['children.fields', { 'children.fields': 'userId,secret' }],
    ])('rejects a forbidden field in %s with 400', async (_param, overrides) => {
      await expect(controller.getNoteById('n1', user, getQuery(overrides))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(notes.getNoteById).not.toHaveBeenCalled();
    });

    // D8: fields are not trimmed (the normalized result of validateAndNormalizeFields is unused).
    it('D8 (current behaviour): rejects a field list with spaces after commas', async () => {
      await expect(
        controller.getNoteById('n1', user, getQuery({ fields: 'title, content' })),
      ).rejects.toThrow('Forbidden field " content"');
    });
  });

  it('updateNoteById updates the note of the current user', async () => {
    notes.updateNoteById.mockResolvedValue(note);
    await expect(controller.updateNoteById('n1', { title: 'x' }, user)).resolves.toBe(note);
    expect(notes.updateNoteById).toHaveBeenCalledWith('n1', { title: 'x' }, 'user-1');
  });

  it('importNotes imports for the current user', async () => {
    const result = { dryRun: true, rootNoteId: null, created: 1, skipped: [], warnings: [] };
    notesImport.importNotes.mockResolvedValue(result);
    const dto: ImportNotesDto = { files: [{ path: 'a.md', content: 'x' }], dryRun: true };

    await expect(controller.importNotes(dto, user)).resolves.toBe(result);
    expect(notesImport.importNotes).toHaveBeenCalledWith(dto, 'user-1');
  });
});
