import { IMPORT_SKIP_REASON } from './importPlan.types';

export type PathRejection =
  | typeof IMPORT_SKIP_REASON.invalidPath
  | typeof IMPORT_SKIP_REASON.hidden;

export type NormalizedImportPath =
  | { ok: true; segments: string[] }
  | { ok: false; reason: PathRejection };

const WINDOWS_DRIVE = /^[a-z]:\//i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
/** Markdown and plain text files; `.txt` is imported as markdown. */
export const IMPORTABLE_EXTENSION = /\.(?:md|markdown|txt)$/i;

/**
 * Splits a path sent by the browser (`webkitRelativePath`, a zip entry) into segments.
 * The server never touches the file system, so this only keeps the report consistent and
 * rejects paths that make no sense in a note tree. NFC because macOS produces NFD file names.
 */
export function normalizeImportPath(path: string): NormalizedImportPath {
  const normalized = path.normalize('NFC').replace(/\\/g, '/');

  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    WINDOWS_DRIVE.test(normalized) ||
    CONTROL_CHAR.test(normalized)
  ) {
    return { ok: false, reason: IMPORT_SKIP_REASON.invalidPath };
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.trim() === '' || segment === '.' || segment === '..')) {
    return { ok: false, reason: IMPORT_SKIP_REASON.invalidPath };
  }

  // `.obsidian/`, `.trash/`, `.DS_Store` and other dot files are app state, not notes.
  if (segments.some((segment) => segment.startsWith('.'))) {
    return { ok: false, reason: IMPORT_SKIP_REASON.hidden };
  }

  return { ok: true, segments };
}

export function isImportablePath(path: string): boolean {
  return IMPORTABLE_EXTENSION.test(path);
}
