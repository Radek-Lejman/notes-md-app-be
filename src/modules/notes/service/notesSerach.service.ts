import { Injectable, Logger } from '@nestjs/common';
import { NotesService } from './notes.service';
import { NoteSearchResult } from '../interfaces/notes.interface';
import { SearchNotesQueryDto } from '../dto/searchNotesQueryDto';
import { FieldSelector } from '@core/selector/types';
import { fromStringToArray } from '@core/utils';
import { buildFieldSelector } from '@core/selector/utils';
import { decodeCursor } from '../utils/searchCursorPayload';
import { toTsQuery } from '@database/prisma';
import { buildNoteSearchOrderBy } from '../utils/orderByForSearch';
import { buildSnippet } from '../utils/markdownText';

@Injectable()
export class NotesSearchService {
  private readonly logger = new Logger(NotesSearchService.name);

  constructor(private readonly notesService: NotesService) {}

  async searchByText(sub: string, query: SearchNotesQueryDto): Promise<NoteSearchResult[]> {
    const rootSelector = this.buildRootNodeSelector(query);
    if (!rootSelector) {
      return [];
    }

    const cursor = decodeCursor(query.cursor);
    const cursorId = cursor?.id;
    const take = query.limit;

    const tsq = toTsQuery(query.q);
    if (!tsq) {
      this.logger.log(`Skip FTS – empty tsquery for input: "${query.q}"`);
      return [];
    }

    // Content is always loaded for the snippet, but only returned when it was asked for.
    const foundNotes = await this.notesService.getNoteByText(
      sub,
      { ...rootSelector, content: true },
      tsq,
      { orderBy: buildNoteSearchOrderBy(query.order, tsq), take, cursorId },
    );

    return (foundNotes ?? []).map(({ content, ...note }) => ({
      ...note,
      ...(rootSelector.content && { content }),
      snippet: buildSnippet(content ?? '', query.q),
    }));
  }

  private buildRootNodeSelector(query: {
    fields?: string;
  }): FieldSelector<Record<string, true>> | null {
    const rootNotesFields = fromStringToArray(query.fields);
    if (!rootNotesFields) {
      return null;
    }

    return buildFieldSelector(rootNotesFields);
  }
}
