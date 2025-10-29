import { FieldSelector } from '@core/selector/types';

export interface NoteBase {
  title: string;
  content: string;
  parentId?: string | null;
}

export interface Note extends NoteBase {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

export interface NoteWthParent {
  parent?: Partial<Note>;
}
export interface NoteWithChildren {
  children?: NoteWithFamily[];
}
export type NoteWithFamily = Partial<Note> & NoteWthParent & NoteWithChildren;

export type NoteSelector = FieldSelector<Note>;
