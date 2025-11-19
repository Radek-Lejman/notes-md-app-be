import { Prisma } from '@prisma/client';
import { NOTE_SORT_FIELDS } from '../consts/sort.consts';

export interface NoteSearchOptions {
  orderBy: Prisma.NoteOrderByWithRelationInput | Prisma.NoteOrderByWithRelationInput[] | undefined;
  take: number;
  cursorId?: string;
}

export type SearchCursorPayload = { id: string; order: 'updatedAt' | '-updatedAt' };

export type NoteSortable = (typeof NOTE_SORT_FIELDS)[number];

export type NotesSearchOrder = 'rank' | '-rank' | NoteSortable | `-${NoteSortable}`;
