/**
 * Saves a run to eval-runs/ (gitignored: runs hold private questions) and, with --compare,
 * prints the paired comparison with an earlier run.
 */
import { join } from 'node:path';
import { formatComparison } from '../../src/modules/ai/rag/eval/report/formatComparison';
import { compareRuns } from '../../src/modules/ai/rag/eval/run/compareRuns';
import { readRun, RunRecord, writeRun } from '../../src/modules/ai/rag/eval/run/runRecord';

const RUNS_DIR = join(__dirname, '../../eval-runs');

export async function saveRun(record: RunRecord, compareWith: string | undefined): Promise<void> {
  // Read first: a typo in --compare must fail before this run is saved under a misleading name.
  const base = compareWith ? await readRun(RUNS_DIR, compareWith) : null;
  console.log(`\nsaved: ${await writeRun(RUNS_DIR, record)}`);
  if (base) console.log(`\n${formatComparison(compareRuns(base, record), compareWith!)}`);
}
