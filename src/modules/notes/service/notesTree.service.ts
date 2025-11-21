import { Injectable, Logger } from '@nestjs/common';
import { TreeService } from '@core/tree/tree.service';
import { createPerKeyLimiter, fromStringToArray } from '@core/utils';
import { buildFieldSelector } from '@core/selector/utils';
import { FieldSelector } from '@core/selector/types';
import { buildOrderBy } from '@core/sort';
import { NotesService } from './notes.service';
import { Note, NoteWithFamily } from '../interfaces/notes.interface';
import { GetNoteQueryDto } from '../dto/getNoteQuery.dto';
import { DEFAULT_CHILDREN_LIMIT, DEFAULT_CHILDREN_SORT_FIELD } from '../consts/validator.consts';
import { AdapterTreeNotes } from '../utils/notesToTree';
import { clampDepth } from '../utils/note.utils';
import { NotesSortInput } from '../interfaces/notesQuery.interface';

@Injectable()
export class NotesTreeService {
  private readonly logger = new Logger(NotesTreeService.name);

  constructor(private readonly notesService: NotesService) {}

  async getNoteWithFamily(
    id: string,
    query: GetNoteQueryDto,
    userId: string,
  ): Promise<NoteWithFamily | null> {
    const rootSelector = this.buildRootNodeSelector(query);
    if (!rootSelector) {
      return null;
    }

    const rootRow = await this.notesService.getNoteById(id, rootSelector, userId);
    if (!rootRow) {
      return null;
    }

    let parentToRootNote: Note | null = null;

    if (query.expand === 'parent' && rootRow.parentId) {
      const parentRow = await this.notesService.getNoteById(rootRow.parentId, rootSelector, userId);
      if (parentRow) {
        parentToRootNote = { ...parentRow };
      }
    }

    const tree = TreeService.fromRoot<Note>(AdapterTreeNotes.toTree(rootRow));
    const preparedTree = await this.loadChildrenTree(tree, query, userId);

    const finalResult = AdapterTreeNotes.fromTree(preparedTree.getRoot());

    return { ...finalResult, parent: parentToRootNote ?? undefined };
  }

  private async loadChildrenTree(
    notesTree: TreeService<Note>,
    query: GetNoteQueryDto,
    userId: string
  ): Promise<TreeService<Note>> {
    const depth = this.getDepthParam(query);
    if (depth === 0) {
      return notesTree;
    }

    const rootChildrenSelector = this.buildRootChildrenSelector(query);
    if (!rootChildrenSelector) {
      return notesTree;
    }

    const mainParentId = notesTree.getRoot().id;
    const childrenLimit = this.getChildrenLimit(query);
    const childLimiter = createPerKeyLimiter(childrenLimit);

    let searchedNotesIds: string[] = [mainParentId];

    for (let level = 0; level < depth; level++) {
      if (searchedNotesIds.length === 0) {
        break;
      }

      const notesInCurrentDepth =
        (await this.notesService.getNoteByParentId(
          searchedNotesIds,
          rootChildrenSelector,
          this.getChildrenOrderBy(query['children.sort']),
          userId
        )) ?? [];

      if (!notesInCurrentDepth.length) {
        break;
      }

      searchedNotesIds = [];

      for (const childNode of notesInCurrentDepth) {
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

        searchedNotesIds.push(treeChild.id);
      }
    }

    return notesTree;
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

  private buildRootChildrenSelector(query: {
    ['children.fields']?: string;
    fields?: string;
  }): FieldSelector<Record<string, true>> | null {
    const rootChildrenFields =
      fromStringToArray(query['children.fields']) || fromStringToArray(query.fields);

    if (!rootChildrenFields) {
      return null;
    }

    return buildFieldSelector(rootChildrenFields);
  }

  private getDepthParam(query: { depth?: number }): number {
    return clampDepth(query.depth);
  }

  private getChildrenOrderBy(sort?: NotesSortInput) {
    return buildOrderBy(sort, DEFAULT_CHILDREN_SORT_FIELD);
  }

  private getChildrenLimit(query: { ['children.limit']?: number }): number {
    return query['children.limit'] ?? DEFAULT_CHILDREN_LIMIT;
  }
}
