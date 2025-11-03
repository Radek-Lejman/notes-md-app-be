import { Transform } from 'class-transformer';

export function toInt(value: unknown, def: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isInteger(n)) return n;
    }
  }
  return def;
}

/** Decorator for DTOs */
export const ToInt = (def = 0) => Transform(({ value }) => toInt(value, def));
