import { TreeNode } from '@core/tree/tree.types';
import { Note, NoteWithFamily } from '../interfaces/notes.interface';

export class AdapterTreeNotes {
  static toTree(note: Note): TreeNode<Note> {
    const { id, parentId, ...rest } = note;
    return {
      id,
      parentId: parentId ?? null,
      children: [],
      data: { ...rest },
    };
  }

  static fromTree(tree: TreeNode<Note>): NoteWithFamily {
    return {
      ...tree.data,
      id: tree.id,
      parentId: tree.parentId,
      children: tree.children?.map(AdapterTreeNotes.fromTree) ?? [],
    };
  }
}
