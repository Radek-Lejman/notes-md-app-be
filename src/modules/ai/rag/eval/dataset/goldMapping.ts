import { PlannedNote } from 'src/modules/notes/import/importPlan.types';
import { EvalCase } from './schema';

export interface UnmappedGold {
  caseId: string;
  path: string;
}

export interface MappedCases {
  /** Cases whose every gold path resolved; `gold[].note` now holds a note id. */
  cases: EvalCase[];
  /** Gold paths with no note in the import; their cases are left out of scoring. */
  unmapped: UnmappedGold[];
}

/** The import normalizes paths to NFC (macOS file names are NFD), so gold paths must match. */
const normalizePath = (path: string) => path.normalize('NFC');

/** Vault file path -> id of the note that holds its content. */
export function noteIdsByPath(notes: PlannedNote[]): Map<string, string> {
  return new Map(
    notes.flatMap((note) => (note.sourcePath ? [[note.sourcePath, note.id] as const] : [])),
  );
}

/**
 * Swaps gold vault paths for note ids. A case with any unmapped gold path is dropped (a missing
 * gold note would silently lower its recall) and every such path is reported.
 */
export function mapGold(cases: EvalCase[], idByPath: Map<string, string>): MappedCases {
  const mapped: EvalCase[] = [];
  const unmapped: UnmappedGold[] = [];

  for (const evalCase of cases) {
    const missing = evalCase.gold
      .map((ref) => ref.note)
      .filter((path) => !idByPath.has(normalizePath(path)));
    unmapped.push(...missing.map((path) => ({ caseId: evalCase.id, path })));
    if (missing.length) continue;

    mapped.push({
      ...evalCase,
      gold: evalCase.gold.map((ref) => ({ ...ref, note: idByPath.get(normalizePath(ref.note))! })),
    });
  }

  return { cases: mapped, unmapped };
}
