import { Injectable, Logger } from '@nestjs/common';
import { TreeService } from '@core/tree/tree.service';
import { createPerKeyLimiter, fromStringToArray } from '@core/utils';
import { createFieldSelector } from '@core/selector/utils';
import { FieldSelector } from '@core/selector/types';
import { buildOrderBy } from '@core/sort';
import { NotesService } from './notes.service';
import { Note, NoteWithFamily } from '../interfaces/notes.interface';
import { GetNoteQueryDto } from '../dto/get-note.query.dto';
import { DEFAULT_CHILDREN_LIMIT, DEFAULT_CHILDREN_SORT_FIELD } from '../consts/validator.consts';
import { AdapterTreeNotes } from '../utils/notesToTree';
import { clampDepth } from '../utils/note.utils';
import { NotesSortInput } from '../interfaces/notesQuery.interface';

@Injectable()
export class SearchNotesService {
  private notesTree: TreeService<Note> | null = null;
  private query: GetNoteQueryDto | null = null;
  private searchedNoteses: string[] = [];

  private readonly logger = new Logger(SearchNotesService.name);

  constructor(private readonly notesService: NotesService) {}

  async searchById(id: string, query: GetNoteQueryDto): Promise<NoteWithFamily | null> {
    this.query = query;

    if (!this.rootNodeSelector) {
      return null;
    }

    const rootRow = await this.notesService.getNoteById(id, this.rootNodeSelector);
    let parentToRootNote: Note | null = null;
    if (!rootRow) return null;

    if (query.expand === 'parent' && rootRow.parentId) {
      const parentRow = await this.notesService.getNoteById(
        rootRow.parentId,
        this.rootNodeSelector,
      );
      if (parentRow) {
        parentToRootNote = { ...parentRow };
      }
    }
    this.notesTree = TreeService.fromRoot<Note>(AdapterTreeNotes.toTree(rootRow));

    if (!this.notesTree) {
      return rootRow;
    }

    const preparedNotesTree = await this.getAllChildNodes(this.notesTree);

    if (!preparedNotesTree) {
      return rootRow;
    }
    const finalResult = AdapterTreeNotes.fromTree(preparedNotesTree.getRoot());

    return { ...finalResult, parent: parentToRootNote ? parentToRootNote : undefined };
  }

  async getAllChildNodes(notesTree: TreeService<Note>) {
    if (this.depthParam === 0) return notesTree;

    const mainParentId = notesTree.getRoot().id;

    this.searchedNoteses = [mainParentId];
    const childLimiter = createPerKeyLimiter(this.getChidrenLimit);

    for (let level = 0; level < this.depthParam; level++) {
      if (this.searchedNoteses.length === 0) continue;
      if (!this.rootChildrenSelector) {
        return null;
      }

      const notesesInCurrentDepth =
        (await this.notesService.getNoteByParentId(
          this.searchedNoteses,
          this.rootChildrenSelector,
          this.orderByParam,
        )) ?? [];

      if (!notesesInCurrentDepth) {
        break;
      }

      this.searchedNoteses = [];
      for (const childNode of notesesInCurrentDepth) {
        if (!childNode) continue;

        if (!childLimiter.allow(childNode.parentId)) {
          continue;
        }
        const treeChild = AdapterTreeNotes.toTree(childNode);
        if (treeChild.parentId === null) {
          this.logger.warn(`Child note ${treeChild.id} missing parent reference`);
          continue;
        }
        notesTree.addChild(
          treeChild.parentId,
          { ...treeChild.data, id: treeChild.id },
          treeChild.id,
        );
        this.searchedNoteses.push(treeChild.id);
      }
    }
    return notesTree;
  }

  private get rootChildrenSelector(): FieldSelector<Record<string, true>> | null {
    const rootChildrenFields =
      fromStringToArray(this.query?.['children.fields']) || fromStringToArray(this.query?.fields);

    if (!rootChildrenFields) {
      return null;
    }
    return createFieldSelector(rootChildrenFields);
  }

  private get depthParam(): number {
    return clampDepth(this.query?.depth);
  }

  private get rootNodeSelector(): FieldSelector<Record<string, true>> | null {
    const rootNotesFields = fromStringToArray(this.query?.fields);
    if (!rootNotesFields) {
      return null;
    }
    return createFieldSelector(rootNotesFields);
  }

  private get orderByParam() {
    return buildOrderBy(
      this.query?.['children.sort'] as NotesSortInput | undefined,
      DEFAULT_CHILDREN_SORT_FIELD,
    );
  }

  private get getChidrenLimit() {
    return this.query?.['children.limit'] ?? DEFAULT_CHILDREN_LIMIT;
  }
}
