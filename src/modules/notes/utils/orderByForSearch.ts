import { Prisma } from '@prisma/client';
import { NoteSortable, NotesSearchOrder } from '../interfaces/NoteSearch';
import { NOTE_SORT_FIELDS } from '../consts/sort.consts';
import { NOTE_SEARCH_RELEVANCE_FIELDS } from '../consts/search.const';
import { buildOrderBy, SortInput } from '@core/sort';

export function buildNoteSearchOrderBy(
  order: NotesSearchOrder | undefined,
  searchExpr: string | undefined,
): Prisma.NoteOrderByWithRelationInput | Prisma.NoteOrderByWithRelationInput[] {
  if ((order === 'rank' || order === '-rank') && searchExpr) {
    const sort: Prisma.SortOrder = order === 'rank' ? 'asc' : 'desc';

    const byRelevance: Prisma.NoteOrderByWithRelationInput = {
      _relevance: {
        fields: NOTE_SEARCH_RELEVANCE_FIELDS,
        search: searchExpr,
        sort,
      },
    };

    const tieBreakers: Prisma.NoteOrderByWithRelationInput[] = [
      { updatedAt: 'desc' },
      { id: 'asc' },
    ];

    return [byRelevance, ...tieBreakers];
  }

  const plainSort = buildOrderBy<NoteSortable>(
    order as SortInput<NoteSortable> | undefined,
    'updatedAt',
    NOTE_SORT_FIELDS,
  );

  return plainSort;
}
