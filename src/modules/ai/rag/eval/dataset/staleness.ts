import { createHash } from 'node:crypto';
import { ImportFileInput } from 'src/modules/notes/import/importPlan.types';
import { EvalCase } from './schema';

export const STALENESS = {
  fresh: 'fresh',
  /** Gold without pinned hashes: scored, but nothing guards it against vault edits. */
  unpinned: 'unpinned',
  stale: 'stale',
} as const;

export type Staleness =
  | { status: typeof STALENESS.fresh }
  | { status: typeof STALENESS.unpinned }
  | { status: typeof STALENESS.stale; missing: string[]; changed: string[] };

/** The import normalizes paths to NFC (macOS file names are NFD), so lookups must too. */
const key = (path: string) => path.normalize('NFC');

/** Vault path -> sha256 of the raw file, the same hash the labels were pinned with. */
export function hashVault(files: ImportFileInput[]): Map<string, string> {
  return new Map(
    files.map(({ path, content }) => [
      key(path),
      createHash('sha256').update(content).digest('hex'),
    ]),
  );
}

/**
 * The vault keeps changing, so gold labels rot. A changed gold note does not make the label
 * wrong, only unconfirmed: a human re-checks it and re-pins (`npm run rag:dataset -- pin`).
 */
export function checkStaleness(evalCase: EvalCase, hashes: Map<string, string>): Staleness {
  const paths = evalCase.gold.map((ref) => ref.note);
  const missing = paths.filter((path) => !hashes.has(key(path)));
  if (missing.length) return { status: STALENESS.stale, missing, changed: [] };

  const pinned = evalCase.goldHashes;
  if (paths.length && Object.keys(pinned).length === 0) return { status: STALENESS.unpinned };

  const changed = paths.filter(
    (path) => pinned[path] !== undefined && pinned[path] !== hashes.get(key(path)),
  );
  if (changed.length) return { status: STALENESS.stale, missing: [], changed };
  return { status: STALENESS.fresh };
}

export interface StaleCase {
  caseId: string;
  missing: string[];
  changed: string[];
}

/** The stale cases of a dataset, for the report and for leaving them out of scoring. */
export function findStale(cases: EvalCase[], hashes: Map<string, string>): StaleCase[] {
  return cases.flatMap((evalCase) => {
    const staleness = checkStaleness(evalCase, hashes);
    if (staleness.status !== STALENESS.stale) return [];
    return [{ caseId: evalCase.id, missing: staleness.missing, changed: staleness.changed }];
  });
}

/** Pins the current hash of every gold note that still exists. */
export function pinHashes(evalCase: EvalCase, hashes: Map<string, string>): EvalCase {
  const goldHashes = Object.fromEntries(
    evalCase.gold.flatMap(({ note }) => {
      const hash = hashes.get(key(note));
      return hash ? [[note, hash]] : [];
    }),
  );
  return { ...evalCase, goldHashes };
}
