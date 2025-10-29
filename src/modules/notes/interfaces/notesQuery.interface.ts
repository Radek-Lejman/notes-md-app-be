import { Note } from './notes.interface';

export type NoteSortableField = keyof Pick<Note, 'createdAt' | 'updatedAt' | 'title'>;
export type NotesSortInput = NoteSortableField | `-${NoteSortableField}`;
