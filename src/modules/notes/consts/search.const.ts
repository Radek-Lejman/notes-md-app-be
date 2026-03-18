import { Prisma } from '@prisma/client';
import { Note } from '../interfaces/notes.interface';

export const NOTE_SEARCHABLE_FIELDS = ['title', 'content'] as const satisfies ReadonlyArray<
  keyof Note
>;

export const NOTE_SEARCH_RELEVANCE_FIELDS: Prisma.NoteOrderByRelevanceFieldEnum[] = [
  'title',
];
