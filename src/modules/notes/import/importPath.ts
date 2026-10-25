export type PathRejection = 'invalid-path' | 'hidden';

export type NormalizedImportPath =
  | { ok: true; segments: string[] }
  | { ok: false; reason: PathRejection };

const WINDOWS_DRIVE = /^[a-z]:\//i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
const IMPORTABLE_EXTENSION = /\.(?:md|markdown|txt)$/i;

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
    return { ok: false, reason: 'invalid-path' };
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.trim() === '' || segment === '.' || segment === '..')) {
    return { ok: false, reason: 'invalid-path' };
  }

  // `.obsidian/`, `.trash/`, `.DS_Store` and other dot files are app state, not notes.
  if (segments.some((segment) => segment.startsWith('.'))) {
    return { ok: false, reason: 'hidden' };
  }

  return { ok: true, segments };
}

/** Markdown and plain text files; `.txt` is imported as markdown. */
export function isImportablePath(path: string): boolean {
  return IMPORTABLE_EXTENSION.test(path);
}
