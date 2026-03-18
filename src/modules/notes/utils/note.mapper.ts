import { Prisma, Note as PrismaNote } from '@prisma/client';
import { Note, NoteBase, TiptapNode } from '../interfaces/notes.interface';

export class NoteMapper {

  static toDomain(prismaNote: PrismaNote): Note;
  static toDomain(prismaNote: PrismaNote | null): Note | null;
  static toDomain(prismaNote: PrismaNote | null): Note | null {
    if (!prismaNote) return null;
    
    return {
      ...prismaNote,
      ...(prismaNote.content && { content: prismaNote.content as TiptapNode }),
    } as Note;
  }


  static toDomainList(prismaNotes: PrismaNote[]): Note[] {
    if (!prismaNotes) return [];
    return prismaNotes.map((note) => this.toDomain(note) as Note);
  }

  static toPersistenceCreate(domainNote: NoteBase, userId: string): Prisma.NoteCreateInput {
    return {
      title: domainNote.title,
      content: domainNote.content as Prisma.InputJsonObject,
      user: { connect: { id: userId } },
      ...(domainNote.parentId && { parent: { connect: { id: domainNote.parentId } } }),
    };
  }

  static toPersistenceUpdate(domainNote: NoteBase): Prisma.NoteUpdateInput {
    return {
      title: domainNote.title,
      content: domainNote.content as Prisma.InputJsonObject,
      ...(domainNote.parentId && { parent: { connect: { id: domainNote.parentId } } }),
    };
  }
}
