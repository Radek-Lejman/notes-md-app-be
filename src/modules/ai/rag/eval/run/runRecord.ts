import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { EvalCase, QuestionType } from '../dataset/schema';
import { CaseResult, metricValues } from '../report/aggregate';
import { EvalConfig } from './evalConfig';

/** JSON has no NaN: an estimate over zero values (e.g. no gold heading) is stored as null. */
const Estimate = z.object({
  metric: z.string(),
  mean: z.number().nullable(),
  lo: z.number().nullable(),
  hi: z.number().nullable(),
  n: z.number(),
});

export const RunCase = z.object({
  id: z.string(),
  type: QuestionType,
  question: z.string(),
  firstGoldRank: z.number().nullable(),
  /** `metricValues` of the case; null = not applicable. Runs are compared on these. */
  metrics: z.record(z.string(), z.number().nullable()),
});
export type RunCase = z.infer<typeof RunCase>;

/** One eval run as saved in eval-runs/: enough to compare it with any later run. */
export const RunRecord = z.object({
  createdAt: z.string(),
  label: z.string().nullable(),
  config: EvalConfig,
  /** Same hash = same questions and labels. */
  datasetHash: z.string(),
  /** Same fingerprint = same chunks and embeddings; a rebuild alone moves a case or two. */
  indexFingerprint: z.string(),
  /** Left out of scoring: gold changed since pinning, or gold path not in the vault. */
  excluded: z.object({ stale: z.array(z.string()), unmapped: z.array(z.string()) }),
  overall: z.array(Estimate),
  cases: z.array(RunCase),
});
export type RunRecord = z.infer<typeof RunRecord>;

const RUN_EXTENSION = '.json';
/** The label goes into the file name after `_`, so `_` itself would make labels ambiguous. */
const SAFE_LABEL = /^[A-Za-z0-9-]+$/;

export function toRunCase(result: CaseResult): RunCase {
  const { id, type, question, scores } = result;
  return { id, type, question, firstGoldRank: scores.firstGoldRank, metrics: metricValues(result) };
}

export function datasetHash(cases: EvalCase[]): string {
  return createHash('sha256')
    .update(cases.map((evalCase) => JSON.stringify(evalCase)).join('\n'))
    .digest('hex');
}

/** Checked before a run starts, so a bad label does not waste the run. */
export function assertRunLabel(label: string | null): void {
  if (label && !SAFE_LABEL.test(label)) {
    throw new Error(`Label "${label}": use letters, digits and - only`);
  }
}

/** Sortable by time; the label (if any) makes it findable by `--compare <label>`. */
export function runFileName(record: Pick<RunRecord, 'createdAt' | 'label'>): string {
  assertRunLabel(record.label);
  const stamp = record.createdAt.replace(/[:.]/g, '-');
  const suffix = record.label ? `_${record.label}` : '';
  return `${stamp}${suffix}${RUN_EXTENSION}`;
}

export async function writeRun(dir: string, record: RunRecord): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, runFileName(record));
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/**
 * A run by file path, or the newest run in `dir` saved with that label
 * (`--compare baseline` instead of a long file name).
 */
export async function readRun(dir: string, ref: string): Promise<RunRecord> {
  const file = ref.endsWith(RUN_EXTENSION) ? ref : await newestWithLabel(dir, ref);
  return RunRecord.parse(JSON.parse(await readFile(file, 'utf8')));
}

async function newestWithLabel(dir: string, label: string): Promise<string> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(`_${label}${RUN_EXTENSION}`));
  if (names.length === 0) throw new Error(`No run labelled "${label}" in ${dir}`);
  return join(dir, names.sort().at(-1)!);
}
