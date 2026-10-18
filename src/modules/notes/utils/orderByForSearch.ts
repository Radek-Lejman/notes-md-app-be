import { Prisma } from '@prisma/client';
import { NoteSortable, NotesSearchOrder } from '../interfaces/NoteSearch';
import { NOTE_SORT_FIELDS } from '../consts/sort.consts';
import { buildOrderBy, SortInput } from '@core/sort';

/** Plain (non-relevance) sort of search results; `rank`/`-rank` are ranked in the database. */
export function buildNoteSearchOrderBy(
  order: NotesSearchOrder | undefined,
): Prisma.NoteOrderByWithRelationInput | Prisma.NoteOrderByWithRelationInput[] {
  return buildOrderBy<NoteSortable>(
    order as SortInput<NoteSortable> | undefined,
    'updatedAt',
    NOTE_SORT_FIELDS,
  );
}
