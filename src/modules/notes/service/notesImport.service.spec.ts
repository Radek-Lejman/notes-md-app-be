import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';
import { MAX_IMPORT_TOTAL_BYTES } from '../consts/import.consts';
import { ImportNotesDto } from '../dto/importNotes.dto';
import { IMPORT_BATCH_SIZE, NotesImportService } from './notesImport.service';
import { NotesService } from './notes.service';

interface CreateManyArgs {
  data: { id: string; userId: string; parentId: string | null; createdAt: Date; updatedAt: Date }[];
}

describe('NotesImportService', () => {
  const createMany = jest.fn<Promise<{ count: number }>, [CreateManyArgs]>();
  const $transaction = jest.fn();
  const assertOwnedNote = jest.fn<Promise<void>, [string, string]>();
  const service = new NotesImportService(
    { $transaction } as unknown as PrismaService,
    { assertOwnedNote } as unknown as NotesService,
  );
  const now = new Date('2026-10-25T12:00:00.000Z');

  const sequentialIds = () => {
    let next = 0;
    return () => `id-${next++}`;
  };
  const dto = (overrides: Partial<ImportNotesDto> = {}): ImportNotesDto => ({
    files: [
      { path: 'Projects/Docker.md', content: '# Docker' },
      { path: 'Inbox.md', content: 'see [[Docker]]' },
    ],
    dryRun: false,
    ...overrides,
  });
  const run = (input: ImportNotesDto) => service.importNotes(input, 'user-1', sequentialIds(), now);
  const rows = () => createMany.mock.calls.flatMap(([args]) => args.data);

  beforeEach(() => {
    jest.resetAllMocks();
    createMany.mockResolvedValue({ count: 0 });
    $transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ note: { createMany } }),
    );
  });

  it('dryRun reports without writing', async () => {
    await expect(run(dto({ dryRun: true }))).resolves.toEqual({
      dryRun: true,
      rootNoteId: null,
      created: 4,
      skipped: [],
      warnings: [],
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('creates the notes for the user, parents first, with increasing createdAt', async () => {
    await expect(run(dto())).resolves.toMatchObject({
      dryRun: false,
      rootNoteId: 'id-0',
      created: 4,
    });

    const data = rows();
    expect(data.map((row) => row.userId)).toEqual(['user-1', 'user-1', 'user-1', 'user-1']);
    expect(data[0]).toMatchObject({ id: 'id-0', parentId: null, title: 'Import 2026-10-25' });
    data.forEach((row, index) => {
      expect(row.createdAt.getTime()).toBe(now.getTime() + index);
      expect(row.updatedAt).toEqual(row.createdAt);
      if (row.parentId) {
        expect(data.findIndex((parent) => parent.id === row.parentId)).toBeLessThan(index);
      }
    });
    expect($transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
  });

  it('uses the given name for the root', async () => {
    await run(dto({ name: '  Obsidian vault ' }));
    expect(rows()[0]).toMatchObject({ title: 'Obsidian vault' });
  });

  it('puts the root under an owned target note', async () => {
    await run(dto({ targetParentId: 'target' }));

    expect(assertOwnedNote).toHaveBeenCalledWith('target', 'user-1');
    expect(rows()[0].parentId).toBe('target');
    expect(rows().filter((row) => row.parentId === 'target')).toHaveLength(1);
  });

  it("refuses someone else's or a missing target note without writing", async () => {
    assertOwnedNote.mockRejectedValue(new NotFoundException('Note not found'));

    await expect(run(dto({ targetParentId: 'foreign' }))).rejects.toBeInstanceOf(NotFoundException);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('writes in batches', async () => {
    const files = Array.from({ length: IMPORT_BATCH_SIZE + 10 }, (_, i) => ({
      path: `note ${i}.md`,
      content: 'x',
    }));
    await run(dto({ files }));

    expect(createMany.mock.calls.map(([args]) => args.data.length)).toEqual([
      IMPORT_BATCH_SIZE,
      11,
    ]);
  });

  it('counts the size limit in UTF-8 bytes', async () => {
    // 2 bytes per character: under the limit in characters, over it in bytes.
    const content = 'ż'.repeat(MAX_IMPORT_TOTAL_BYTES / 2 + 1);

    await expect(run(dto({ files: [{ path: 'a.md', content }] }))).rejects.toThrow(
      new BadRequestException('The import is larger than 15 MB'),
    );
    expect(assertOwnedNote).not.toHaveBeenCalled();
  });

  it('maps a plan error to 400', async () => {
    await expect(run(dto({ mode: 'split-h1' }))).rejects.toThrow(
      new BadRequestException('Splitting by H1 needs exactly one file'),
    );
  });

  it('refuses an import with nothing to create, but reports it in a dry run', async () => {
    const files = [{ path: 'photo.png', content: 'x' }];

    await expect(run(dto({ files }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(dto({ files, dryRun: true }))).resolves.toMatchObject({
      created: 1,
      skipped: [{ path: 'photo.png', reason: 'not-markdown' }],
    });
  });

  const knownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' });

  it.each([
    ['P2003', NotFoundException],
    ['P2000', BadRequestException],
    ['P2007', BadRequestException],
  ])('maps a known database error %s to 4xx', async (code, expected) => {
    $transaction.mockRejectedValue(knownError(code));
    await expect(run(dto())).rejects.toBeInstanceOf(expected);
  });

  it('propagates other errors', async () => {
    const other = knownError('P1001');
    $transaction.mockRejectedValue(other);
    await expect(run(dto())).rejects.toBe(other);

    const plain = new Error('boom');
    $transaction.mockRejectedValue(plain);
    await expect(run(dto())).rejects.toBe(plain);
  });
});
