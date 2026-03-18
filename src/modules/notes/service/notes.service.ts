import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';
import { Note, NoteBase, NoteSelector } from '../interfaces/notes.interface';
import { Prisma } from '@prisma/client';
import { NoteSearchOptions } from '../interfaces/NoteSearch';
import { NoteMapper } from '../utils/note.mapper';
import { NotesPgRepository } from '../utils/notesPgRepository';

@Injectable()
export class NotesService {
  constructor(
    private readonly notesPgRepository: NotesPgRepository,
    private readonly prismaService: PrismaService) {}

  async updateNote(note: NoteBase, noteId: string): Promise<Note> {
    const updated = await this.prismaService.note.update({
      where: {
        id: noteId,
      },
      data: NoteMapper.toPersistenceUpdate(note),
    });
    return NoteMapper.toDomain(updated);
  }
  
  public async createNote(note: NoteBase, userId: string): Promise<Note> {
    const created = await this.prismaService.note.create({
      data: NoteMapper.toPersistenceCreate(note, userId),
    });
    return NoteMapper.toDomain(created);
  }
  
  public async getAllNotes(userId: string): Promise<Note[]> {
    const notes = await this.prismaService.note.findMany({
      where: {
        userId,
      },
    });
    return NoteMapper.toDomainList(notes);
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
    return NoteMapper.toDomain(note) as Note | null;
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
    // while leveraging efficient PostgreSQL GIN indexes for FTS on JSONB fields.
    const searchResults = await this.notesPgRepository.searchNotesDb(userId, q);

    const matchingIds = searchResults.map((row) => row.id);

    if (matchingIds.length === 0) {
      return [];
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
