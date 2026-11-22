import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { EvalCase, readJsonl } from './schema';

const DATASET_EXTENSION = '.jsonl';

/** The `.jsonl` files of a dataset path: the file itself, or a folder's files in name order. */
export async function datasetFiles(path: string): Promise<string[]> {
  if (!(await stat(path)).isDirectory()) return [path];
  return (await readdir(path))
    .filter((name) => name.endsWith(DATASET_EXTENSION))
    .sort()
    .map((name) => join(path, name));
}

/**
 * The eval cases of a dataset: one `.jsonl` file, or every `.jsonl` file of a folder (in name
 * order, e.g. hand-written seeds next to synthetic cases). Datasets hold private notes, so they
 * live outside the repo. Ids must be unique across files: runs are compared case by case.
 */
export async function readDataset(path: string): Promise<EvalCase[]> {
  const files = await datasetFiles(path);
  const cases = (await Promise.all(files.map((file) => readJsonl(file, EvalCase)))).flat();
  if (cases.length === 0) throw new Error(`No eval cases in ${path}`);

  const ids = cases.map(({ id }) => id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`Duplicate case ids in ${path}: ${duplicates.join(', ')}`);

  return cases;
}
