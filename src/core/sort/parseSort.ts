import { DEFAULT_CHILDREN_SORT_DIR } from './config';
import { SortInput, SortDir } from './sort.types';

export function buildOrderBy<F extends string>(
  sort: SortInput<F> | undefined,
  defaultField: F,
  allowedFields?: readonly F[],
) {
  if (!sort) {
    return { [defaultField]: DEFAULT_CHILDREN_SORT_DIR };
  }

  const isDesc = sort.startsWith('-');
  const rawField = (isDesc ? sort.slice(1) : sort) as F;

  if (allowedFields && !allowedFields.includes(rawField)) {
    throw new Error(`Invalid sort field: "${rawField}". Allowed: ${allowedFields.join(', ')}`);
  }

  return { [rawField]: isDesc ? SortDir.DESC : SortDir.ASC };
}
