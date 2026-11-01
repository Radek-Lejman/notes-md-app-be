import { MAX_IMPORT_TITLE_LENGTH } from '../consts/import.consts';
import { MIN_CONTENT_LENGTH } from '../consts/validator.consts';
import { IMPORTABLE_EXTENSION } from './importPath';

export type TitleWarning = 'title-fallback' | 'title-truncated';

export interface ImportTitle {
  title: string;
  warning: TitleWarning | null;
}

/** The last-resort title when neither the file nor its folder gives one. */
export const UNTITLED_NOTE_TITLE = 'Untitled';

// Notion exports append the page id: "Plan 1a2b…(32 hex).md".
const NOTION_ID = / [0-9a-f]{32}$/i;

export function folderTitle(name: string): string {
  return name.replace(NOTION_ID, '').trim();
}

export function fileTitle(name: string): string {
  return folderTitle(name.replace(IMPORTABLE_EXTENSION, ''));
}

/**
 * A title that passes the note rules: the candidate (frontmatter `title:` or the file name), else
 * the fallback (the folder name or "Untitled"); padded to the minimum length, truncated to the
 * import maximum.
 */
export function importTitle(candidate: string | null, fallback: string): ImportTitle {
  let title = (candidate ?? '').normalize('NFC').trim();
  let warning: TitleWarning | null = null;

  if (title === '') {
    title = fallback.normalize('NFC').trim();
    warning = 'title-fallback';
  }

  if (title.length < MIN_CONTENT_LENGTH) {
    title = `${title} (import)`.trim();
    warning = 'title-fallback';
  }

  if (title.length > MAX_IMPORT_TITLE_LENGTH) {
    let cut = title.slice(0, MAX_IMPORT_TITLE_LENGTH - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    title = `${cut.trimEnd()}…`;
    warning = 'title-truncated';
  }

  return { title, warning };
}
