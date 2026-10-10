import { FieldSelector } from '@core/selector/types';

export interface NoteBase {
  title: string;
  /** Markdown. */
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

/** A note in lists and trees: everything but the (potentially large) content. */
export type NoteSummary = Omit<Note, 'content'>;

/** A search hit: the requested fields plus a plain-text excerpt around the match. */
export type NoteSearchResult = Partial<Note> & { id: string; snippet: string };

export type NoteSelector = FieldSelector<Note>;
