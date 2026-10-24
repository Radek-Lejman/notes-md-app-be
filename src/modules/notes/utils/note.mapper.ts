import { Prisma, Note as PrismaNote } from '@prisma/client';
import { Note, NoteBase } from '../interfaces/notes.interface';
import { UpdateNoteDto } from '../dto/note.dto';

/** A note row as loaded by PrismaService, which never loads the RAG bookkeeping. */
type NoteRow = Omit<PrismaNote, 'ragIndexedAt'>;

export class NoteMapper {
  static toDomain(prismaNote: NoteRow): Note;
  static toDomain(prismaNote: NoteRow | null): Note | null;
  static toDomain(prismaNote: NoteRow | null): Note | null {
    if (!prismaNote) return null;
    return { ...prismaNote };
  }

  static toDomainList(prismaNotes: NoteRow[]): Note[] {
    if (!prismaNotes) return [];
    return prismaNotes.map((note) => this.toDomain(note));
  }

  /** The parent is connected only among the user's own notes (D14): a foreign one fails with P2025. */
  static toPersistenceCreate(domainNote: NoteBase, userId: string): Prisma.NoteCreateInput {
    return {
      title: domainNote.title,
      content: domainNote.content,
      user: { connect: { id: userId } },
      ...(domainNote.parentId && {
        parent: { connect: { id: domainNote.parentId, userId } },
      }),
    };
  }

  /** The parent is connected only among the user's own notes (D14): a foreign one fails with P2025. */
  static toPersistenceUpdate(domainNote: UpdateNoteDto, userId: string): Prisma.NoteUpdateInput {
    const updateInput: Prisma.NoteUpdateInput = {};

    if (domainNote.title !== undefined) {
      updateInput.title = domainNote.title;
    }

    if (domainNote.content !== undefined) {
      updateInput.content = domainNote.content;
    }

    if (domainNote.parentId !== undefined) {
      updateInput.parent =
        domainNote.parentId === null
          ? { disconnect: true }
          : { connect: { id: domainNote.parentId, userId } };
    }

    return updateInput;
  }
}
