import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma/prisma.service';
import { Note, NoteBase, NoteSelector } from '../interfaces/notes.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class NotesService {
  updateNote(note: NoteBase, noteId: string) {
    return this.prismaService.note.update({
      where: {
        id: noteId,
      },
      data: {
        ...note,
      },
    });
  }
  constructor(private readonly prismaService: PrismaService) {}
  public createNote(note: NoteBase, userId: string): Promise<Note> {
    return this.prismaService.note.create({
      data: {
        ...note,
        userId,
      },
    });
  }
  public getAllNotes(userId: string): Promise<Note[]> {
    return this.prismaService.note.findMany({
      where: {
        userId,
      },
    });
  }

  public async getNoteById(id: string, selector: NoteSelector): Promise<Note | null> {
    return await this.prismaService.note.findUnique({
      where: {
        id,
      },
      select: {
        ...selector,
        id: true,
        parentId: true,
      },
    });
  }

  public async getNoteByParentId(
    parentIds: string[],
    selector: NoteSelector,
    orderBy: Prisma.NoteOrderByWithRelationInput | undefined,
  ): Promise<Note[]> {
    if (!parentIds.length) return [];
    return this.prismaService.note.findMany({
      where: { parentId: { in: parentIds } },
      select: { ...selector, parentId: true },
      orderBy,
    });
  }
}
