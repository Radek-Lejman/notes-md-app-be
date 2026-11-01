import type { TitleWarning } from './importTitle';
import type { LinkWarningKind } from './resolveLinks';

/*
 * The import plan and its report (POST /notes/import response).
 * KEEP IN SYNC with notes-app-fe/src/entities/notes/model/import.types.ts.
 */

export const IMPORT_MODE = {
  files: 'files',
  splitH1: 'split-h1',
} as const;
export type ImportMode = (typeof IMPORT_MODE)[keyof typeof IMPORT_MODE];

export interface ImportFileInput {
  path: string;
  content: string;
}

export const IMPORT_SKIP_REASON = {
  notMarkdown: 'not-markdown',
  binary: 'binary',
  empty: 'empty',
  duplicatePath: 'duplicate-path',
  invalidPath: 'invalid-path',
  hidden: 'hidden',
} as const;
export type ImportSkipReason = (typeof IMPORT_SKIP_REASON)[keyof typeof IMPORT_SKIP_REASON];

export type ImportWarningKind = LinkWarningKind | 'lossy-content' | TitleWarning;

export interface ImportReport {
  created: number;
  skipped: { path: string; reason: ImportSkipReason }[];
  warnings: { path: string; kind: ImportWarningKind; detail: string }[];
}

export interface PlannedNote {
  id: string;
  /** null for the import root; every other parent is a note from the plan. */
  parentId: string | null;
  title: string;
  content: string;
  /** Position among all planned notes, parents first; encodes the sibling order. */
  order: number;
}

export interface ImportPlan {
  notes: PlannedNote[];
  report: ImportReport;
}
