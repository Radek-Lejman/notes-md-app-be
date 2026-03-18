import { FieldSelector } from '@core/selector/types';

export interface NoteBase {
  title: string;
  content: TiptapNode;
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


export type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Record<string, unknown>[];
  text?: string;
};

