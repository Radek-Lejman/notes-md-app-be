import { Note } from '../interfaces/notes.interface';

export const ALLOWED_NOTE_FIELDS = [
  'title',
  'content',
  'createdAt',
  'updatedAt',
  'userId',
  'parentId',
] as const satisfies ReadonlyArray<keyof Note>;
