import { MAX_DEPTH } from '../consts/notes.consts';

export function clampDepth(d?: number | string): number {
  const depth = typeof d === 'string' ? Number(d) : d;
  if (typeof depth !== 'number' || isNaN(depth) || depth < 0) return 0;
  return Math.min(depth, MAX_DEPTH);
}
