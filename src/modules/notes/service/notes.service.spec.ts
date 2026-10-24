import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';
import { NotesService } from './notes.service';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotesPgRepository } from '../utils/notesPgRepository';

describe('NotesService', () => {
  const note = {
    findUnique: jest.fn<Promise<unknown>, [unknown]>(),
    findMany: jest.fn<Promise<unknown>, [unknown]>(),
    create: jest.fn<Promise<unknown>, [unknown]>(),
    update: jest.fn<Promise<unknown>, [unknown]>(),
  };
  const searchNotesDb = jest.fn<Promise<{ id: string; rank?: number }[]>, [string, string]>();
  const service = new NotesService(
    { searchNotesDb } as unknown as NotesPgRepository,
    { note } as unknown as PrismaService,
  );

  const row = {
    id: 'n1',
    title: 'Docker',
    content: '# Docker',
    parentId: null,
    userId: 'user-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  const recordNotFound = () =>
    new Prisma.PrismaClientKnownRequestError('No record was found.', {
      code: 'P2025',
      clientVersion: 'test',
    });

  beforeEach(() => {
    jest.resetAllMocks();
    note.findMany.mockResolvedValue([row]);
  });

  describe('createNote', () => {
    it('creates the note for the current user', async () => {
      note.create.mockResolvedValue(row);

      await expect(
        service.createNote({ title: 'Docker', content: '# Docker' }, 'user-1'),
      ).resolves.toEqual(row);
      expect(note.create).toHaveBeenCalledWith({
        data: { title: 'Docker', content: '# Docker', user: { connect: { id: 'user-1' } } },
      });
    });

    it('nests it under the given parent', async () => {
      note.create.mockResolvedValue(row);
      await service.createNote({ title: 'T', content: '', parentId: 'p1' }, 'user-1');
      expect(note.create.mock.calls[0][0]).toMatchObject({
        data: { parent: { connect: { id: 'p1', userId: 'user-1' } } },
      });
    });

    it("answers 404 for a parent that is missing or another user's (D14)", async () => {
      note.create.mockRejectedValue(recordNotFound());
      await expect(
        service.createNote({ title: 'T', content: '', parentId: 'foreign' }, 'user-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rethrows other database errors unchanged', async () => {
      const failure = new Error('connection lost');
      note.create.mockRejectedValue(failure);
      await expect(service.createNote({ title: 'T', content: '' }, 'user-1')).rejects.toBe(failure);
    });
  });

  it('updateNote changes only the given fields of a note of the current user', async () => {
    note.update.mockResolvedValue({ ...row, title: 'New' });

    await expect(service.updateNote({ title: 'New' }, 'n1', 'user-1')).resolves.toMatchObject({
      title: 'New',
    });
    expect(note.update).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'user-1' },
      data: { title: 'New' },
    });
  });

  it('updateNote answers 404 for a missing note or a note of another user (D5)', async () => {
    note.update.mockRejectedValue(recordNotFound());

    await expect(service.updateNote({ title: 'x' }, 'n1', 'user-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getAllNotes lists the notes of the current user without their content', async () => {
    await expect(service.getAllNotes('user-1')).resolves.toEqual([row]);
    expect(note.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      omit: { content: true },
    });
  });

  describe('getNoteById', () => {
    it("loads the selected fields of the current user's note, always with id and parentId", async () => {
      note.findUnique.mockResolvedValue({ id: 'n1', parentId: null, title: 'Docker' });

      await expect(service.getNoteById('n1', { title: true }, 'user-1')).resolves.toEqual({
        id: 'n1',
        parentId: null,
        title: 'Docker',
      });
      expect(note.findUnique).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'user-1' },
        select: { title: true, id: true, parentId: true },
      });
    });

    it('returns null for a missing note or a note of another user', async () => {
      note.findUnique.mockResolvedValue(null);
      await expect(service.getNoteById('n1', {}, 'user-2')).resolves.toBeNull();
    });
  });

  describe('getNoteByParentId', () => {
    it("loads the children of the given parents, scoped to the user's notes", async () => {
      const orderBy = { createdAt: 'asc' as const };

      await expect(
        service.getNoteByParentId(['p1', 'p2'], { title: true }, orderBy, 'user-1'),
      ).resolves.toEqual([row]);
      expect(note.findMany).toHaveBeenCalledWith({
        where: { parentId: { in: ['p1', 'p2'] }, userId: 'user-1' },
        select: { title: true, id: true, parentId: true },
        orderBy,
      });
    });

    it('skips the query without parents', async () => {
      await expect(service.getNoteByParentId([], {}, undefined, 'user-1')).resolves.toEqual([]);
      expect(note.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getNoteByText', () => {
    const options = { orderBy: { updatedAt: 'desc' as const }, take: 20 };

    it("loads the matching notes of the user's full-text hits, paginated", async () => {
      searchNotesDb.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);

      await expect(
        service.getNoteByText('user-1', { title: true }, 'dock:*', options),
      ).resolves.toEqual([row]);
      expect(searchNotesDb).toHaveBeenCalledWith('user-1', 'dock:*');
      expect(note.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', id: { in: ['n1', 'n2'] } },
        select: { title: true, id: true },
        orderBy: options.orderBy,
        cursor: undefined,
        skip: undefined,
        take: 20,
      });
    });

    it('continues after the cursor note, skipping the cursor itself', async () => {
      searchNotesDb.mockResolvedValue([{ id: 'n1' }]);

      await service.getNoteByText('user-1', {}, 'q', { ...options, cursorId: 'n0' });
      expect(note.findMany.mock.calls[0][0]).toMatchObject({ cursor: { id: 'n0' }, skip: 1 });
    });

    describe('ordered by relevance (rank)', () => {
      const hits = [
        { id: 'low', rank: 0.1 },
        { id: 'top', rank: 0.9 },
        { id: 'b-mid', rank: 0.5 },
        { id: 'a-mid', rank: 0.5 },
      ];
      const loaded = (ids: string[]) => ids.map((id) => ({ ...row, id }));

      beforeEach(() => {
        searchNotesDb.mockResolvedValue(hits);
        // The database returns rows in its own order; the service must restore the ranking.
        note.findMany.mockImplementation((args) => {
          const { where } = args as { where: { id: { in: string[] } } };
          return Promise.resolve(loaded([...where.id.in].reverse()));
        });
      });

      it('returns the best matches first, ties by id, limited to take', async () => {
        const found = await service.getNoteByText('user-1', { title: true }, 'q', {
          orderBy: undefined,
          take: 3,
          rank: 'best-first',
        });

        expect(found.map((n) => n.id)).toEqual(['top', 'a-mid', 'b-mid']);
        expect(note.findMany).toHaveBeenCalledWith({
          where: { userId: 'user-1', id: { in: ['top', 'a-mid', 'b-mid'] } },
          select: { title: true, id: true },
        });
      });

      it('returns the worst matches first for worst-first', async () => {
        const found = await service.getNoteByText('user-1', {}, 'q', {
          orderBy: undefined,
          take: 10,
          rank: 'worst-first',
        });
        expect(found.map((n) => n.id)).toEqual(['low', 'a-mid', 'b-mid', 'top']);
      });

      it('S10: continues after the cursor note in relevance order', async () => {
        const found = await service.getNoteByText('user-1', {}, 'q', {
          orderBy: undefined,
          take: 2,
          rank: 'best-first',
          cursorId: 'a-mid',
        });
        expect(found.map((n) => n.id)).toEqual(['b-mid', 'low']);
      });

      it('returns an empty page for a cursor that no longer matches', async () => {
        const found = await service.getNoteByText('user-1', {}, 'q', {
          orderBy: undefined,
          take: 2,
          rank: 'best-first',
          cursorId: 'gone',
        });
        expect(found).toEqual([]);
        expect(note.findMany).not.toHaveBeenCalled();
      });

      it('skips a note that disappeared between the two queries', async () => {
        note.findMany.mockResolvedValue(loaded(['top']));
        const found = await service.getNoteByText('user-1', {}, 'q', {
          orderBy: undefined,
          take: 2,
          rank: 'best-first',
        });
        expect(found.map((n) => n.id)).toEqual(['top']);
      });
    });

    it('skips the second query when nothing matches', async () => {
      searchNotesDb.mockResolvedValue([]);

      await expect(service.getNoteByText('user-1', {}, 'q', options)).resolves.toEqual([]);
      expect(note.findMany).not.toHaveBeenCalled();
    });
  });
});
