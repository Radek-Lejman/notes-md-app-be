import { SearchCursorPayload } from '../interfaces/NoteSearch';

const CURSOR_ORDERS: readonly SearchCursorPayload['order'][] = [
  'updatedAt',
  '-updatedAt',
  'rank',
  '-rank',
];

export function encodeCursor(p: SearchCursorPayload): string {
  return Buffer.from(JSON.stringify(p)).toString('base64');
}

export function decodeCursor(raw?: string): SearchCursorPayload | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as SearchCursorPayload;
    if (obj && typeof obj.id === 'string' && CURSOR_ORDERS.includes(obj.order)) {
      return obj;
    }
  } catch {}
  return undefined;
}
