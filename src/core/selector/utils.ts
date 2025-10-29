import { FieldSelector } from './types';

export function createFieldSelector<T extends Record<string, true>, K extends keyof T>(
  fields: readonly K[],
): FieldSelector<T> {
  return fields.reduce(
    (acc, f) => {
      acc[f] = true;
      return acc;
    },
    {} as Partial<Record<keyof T, boolean>>,
  ) as FieldSelector<T>;
}

export function parseFields(input?: string): readonly string[] {
  if (!input?.trim()) return [];
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
