import { FieldSelector } from './types';

export function buildFieldSelector<
  TSelectShape extends Record<string, true>,
  K extends keyof TSelectShape,
>(fields: readonly K[]): FieldSelector<TSelectShape> {
  return fields.reduce(
    (acc, f) => {
      acc[f] = true;
      return acc;
    },
    {} as Partial<Record<keyof TSelectShape, boolean>>,
  ) as FieldSelector<TSelectShape>;
}
