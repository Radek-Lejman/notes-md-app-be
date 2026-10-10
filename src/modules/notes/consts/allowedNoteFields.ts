import { Note } from '../interfaces/notes.interface';

export const ALLOWED_NOTE_FIELDS = [
  'title',
  'content',
  'createdAt',
  'updatedAt',
  'userId',
  'parentId',
] as const satisfies ReadonlyArray<keyof Note>;

/** Fields of the requested note when `fields` is not given. */
export const DEFAULT_ROOT_FIELDS = [
  'id',
  'title',
  'content',
  'parentId',
  'createdAt',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof Note>;

/** Fields of its children when neither `children.fields` nor `fields` is given: no content. */
export const DEFAULT_CHILDREN_FIELDS = [
  'id',
  'title',
  'parentId',
  'createdAt',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof Note>;
