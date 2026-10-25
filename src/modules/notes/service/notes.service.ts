import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';
import { Note, NoteBase, NoteSelector, NoteSummary } from '../interfaces/notes.interface';
import { UpdateNoteDto } from '../dto/note.dto';
import { Prisma } from '@prisma/client';
import { NoteSearchOptions } from '../interfaces/NoteSearch';
import { NoteMapper } from '../utils/note.mapper';
import { NotesPgRepository } from '../utils/notesPgRepository';
import { isPrismaKnownError } from '@database/prisma';

/** P2025: the note, or the parent to connect, is missing or belongs to another user (D5, D14). */
function rethrowNotFound(err: unknown): never {
  if (isPrismaKnownError(err) && err.code === 'P2025') {
    throw new NotFoundException('Note not found');
  }
  throw err;
}

@Injectable()
export class NotesService {
  constructor(
    private readonly notesPgRepository: NotesPgRepository,
    private readonly prismaService: PrismaService,
  ) {}

  async updateNote(note: UpdateNoteDto, noteId: string, userId: string): Promise<Note> {
    const updated = await this.prismaService.note
      .update({
        where: {
          id: noteId,
          userId,
        },
        data: NoteMapper.toPersistenceUpdate(note, userId),
      })
      .catch(rethrowNotFound);
    return NoteMapper.toDomain(updated);
  }

  public async createNote(note: NoteBase, userId: string): Promise<Note> {
    const created = await this.prismaService.note
      .create({
        data: NoteMapper.toPersistenceCreate(note, userId),
      })
      .catch(rethrowNotFound);
    return NoteMapper.toDomain(created);
  }

  /**
   * 404 unless the note exists and belongs to the user. For writes that set a scalar `parentId`
   * (`createMany`), which bypass the owner-scoped `connect` of `createNote` (D14).
   */
  public async assertOwnedNote(id: string, userId: string): Promise<void> {
    const note = await this.prismaService.note.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('Note not found');
  }

  public async getAllNotes(userId: string): Promise<NoteSummary[]> {
    return this.prismaService.note.findMany({
      where: {
        userId,
      },
      omit: { content: true },
    });
  }

  public async getNoteById(
    id: string,
    selector: NoteSelector,
    userId: string,
  ): Promise<Note | null> {
    const note = await this.prismaService.note.findUnique({
      where: {
        id,
        userId,
      },
      select: {
        ...selector,
        id: true,
        parentId: true,
      },
    });
    return NoteMapper.toDomain(note);
  }

  public async getNoteByParentId(
    parentIds: string[],
    selector: NoteSelector,
    orderBy: Prisma.NoteOrderByWithRelationInput | undefined,
    userId: string,
  ): Promise<Note[]> {
    if (!parentIds.length) return [];
    const notes = await this.prismaService.note.findMany({
      where: { parentId: { in: parentIds }, userId },
      select: { ...selector, id: true, parentId: true },
      orderBy,
    });
    return NoteMapper.toDomainList(notes);
  }

  async getNoteByText(
    userId: string,
    selector: NoteSelector,
    q: string,
    options: NoteSearchOptions,
  ): Promise<Note[]> {
    const { orderBy, take } = options;
    const cursorId = options.cursorId;

    // Two-stage search pattern: retains Prisma's pagination and type-safety,
    // while leveraging efficient PostgreSQL GIN indexes for FTS on the markdown content.
    const searchResults = await this.notesPgRepository.searchNotesDb(userId, q);

    const matchingIds = searchResults.map((row) => row.id);

    if (matchingIds.length === 0) {
      return [];
    }

    if (options.rank) {
      const direction = options.rank === 'best-first' ? -1 : 1;
      const sorted = [...searchResults].sort(
        (a, b) => direction * (a.rank - b.rank) || a.id.localeCompare(b.id),
      );
      const start = cursorId ? sorted.findIndex((row) => row.id === cursorId) + 1 : 0;
      // Like Prisma's cursor: an id that no longer matches the query gives an empty page.
      if (cursorId && start === 0) return [];
      const rankedIds = sorted.slice(start, start + take).map((row) => row.id);
      const ranked = await this.prismaService.note.findMany({
        where: { userId, id: { in: rankedIds } },
        select: { ...selector, id: true },
      });
      const byId = new Map(ranked.map((note) => [note.id, note]));
      return NoteMapper.toDomainList(
        rankedIds.flatMap((id) => {
          const note = byId.get(id);
          return note ? [note] : [];
        }),
      );
    }

    const notes = await this.prismaService.note.findMany({
      where: {
        userId,
        id: { in: matchingIds },
      },
      select: { ...selector, id: true },
      orderBy,
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : undefined,
      take,
    });
    return NoteMapper.toDomainList(notes);
  }
}
