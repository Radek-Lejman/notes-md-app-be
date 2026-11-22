import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ImportFileInput } from 'src/modules/notes/import/importPlan.types';
import { EvalConfig } from './evalConfig';

/** What the stored chunks and embeddings depend on; search-time settings are left out. */
export type IndexSettings = Pick<EvalConfig, 'embeddingModel' | 'chunkSize' | 'chunkOverlap'>;

/** The eval user's last import: reused while the fingerprint matches. */
export const IndexCache = z.object({
  fingerprint: z.string(),
  userId: z.string(),
  /** All notes of the import (folders and the root too), to detect notes added or removed. */
  noteCount: z.number(),
  idByPath: z.record(z.string(), z.string()),
});
export type IndexCache = z.infer<typeof IndexCache>;

/** sha256 over the vault files (path order, so the file system's order does not matter). */
export function indexFingerprint(files: ImportFileInput[], settings: IndexSettings): string {
  const hash = createHash('sha256');
  // Picked field by field: a caller may pass a whole EvalConfig, and its search-time settings
  // must not invalidate the index.
  hash.update(JSON.stringify([settings.embeddingModel, settings.chunkSize, settings.chunkOverlap]));
  const byPath = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  // JSON per file: escaping keeps file boundaries unambiguous whatever the content holds.
  for (const { path, content } of byPath) hash.update(JSON.stringify([path, content]));
  return hash.digest('hex');
}

/** null when there is no cache yet or it does not parse (then the run re-imports). */
export async function readIndexCache(file: string): Promise<IndexCache | null> {
  try {
    return IndexCache.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

export async function writeIndexCache(file: string, cache: IndexCache): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(cache, null, 2)}\n`);
}
