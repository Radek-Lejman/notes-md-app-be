import { Prisma } from '@prisma/client';
import { NOTE_SORT_FIELDS } from '../consts/sort.consts';

export interface NoteSearchOptions {
  orderBy: Prisma.NoteOrderByWithRelationInput | Prisma.NoteOrderByWithRelationInput[] | undefined;
  take: number;
  /** Id of the last note of the previous page; the next page starts after it. */
  cursorId?: string;
  /** Order by relevance computed in the database (`orderBy` is ignored). */
  rank?: 'best-first' | 'worst-first';
}

export type SearchCursorPayload = {
  id: string;
  order: 'updatedAt' | '-updatedAt' | 'rank' | '-rank';
};

export type NoteSortable = (typeof NOTE_SORT_FIELDS)[number];

export type NotesSearchOrder = 'rank' | '-rank' | NoteSortable | `-${NoteSortable}`;
