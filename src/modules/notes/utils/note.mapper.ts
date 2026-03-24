import { Prisma, Note as PrismaNote } from '@prisma/client';
import { Note, NoteBase, TiptapNode } from '../interfaces/notes.interface';
import { UpdateNoteDto } from '../dto/note.dto';

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

  static toPersistenceUpdate(domainNote: UpdateNoteDto): Prisma.NoteUpdateInput {
    const updateInput: Prisma.NoteUpdateInput = {};

    if (domainNote.title !== undefined) {
      updateInput.title = domainNote.title;
    }

    if (domainNote.content !== undefined) {
      updateInput.content = domainNote.content as Prisma.InputJsonObject;
    }

    if (domainNote.parentId !== undefined) {
      updateInput.parent = domainNote.parentId === null 
        ? { disconnect: true } 
        : { connect: { id: domainNote.parentId } };
    }

    return updateInput;
  }
}
