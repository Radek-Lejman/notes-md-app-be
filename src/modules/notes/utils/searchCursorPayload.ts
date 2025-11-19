import { SearchCursorPayload } from '../interfaces/NoteSearch';

export function encodeCursor(p: SearchCursorPayload): string {
  return Buffer.from(JSON.stringify(p)).toString('base64');
}

export function decodeCursor(raw?: string): SearchCursorPayload | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as SearchCursorPayload;
    if (
      obj &&
      typeof obj.id === 'string' &&
      (obj.order === 'updatedAt' || obj.order === '-updatedAt')
    ) {
      return obj;
    }
  } catch {}
  return undefined;
}
