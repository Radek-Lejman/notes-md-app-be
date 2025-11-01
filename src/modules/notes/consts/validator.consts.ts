import { NoteSortableField } from '../interfaces/notesQuery.interface';

// Children limit param
export const MIN_CHILDREN_LIMIT = 1;
export const MAX_CHILDREN_LIMIT = 200;
export const DEFAULT_CHILDREN_LIMIT = 50;

// Children sort param
export const DEFAULT_CHILDREN_SORT_FIELD: NoteSortableField = 'createdAt';

// Depth param
export const MAX_DEPTH = 10;
export const MIN_DEPTH = 0;
export const DEFAULT_DEPTH = 0;

// General params
export const MIN_CONTENT_LENGTH = 2;
