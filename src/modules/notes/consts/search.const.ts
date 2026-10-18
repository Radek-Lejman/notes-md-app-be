import { Note } from '../interfaces/notes.interface';

export const NOTE_SEARCHABLE_FIELDS = ['title', 'content'] as const satisfies ReadonlyArray<
  keyof Note
>;
