import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { ImportFileInput } from 'src/modules/notes/import/importPlan.types';
import { isImportablePath } from 'src/modules/notes/import/importPath';

/**
 * The vault's importable files with paths relative to `dir`, in import format (`/` separators).
 * Dot entries (`.obsidian/`, `.trash/`) are skipped here because the import would only report
 * them as hidden; everything else is left to `planImport` to accept or report.
 */
export async function readVault(dir: string): Promise<ImportFileInput[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .map((entry) => ({ entry, path: relative(dir, join(entry.parentPath, entry.name)) }))
    .filter(({ entry, path }) => entry.isFile() && isImportablePath(entry.name) && !isHidden(path));

  return Promise.all(
    files.map(async ({ path }) => ({
      path: path.split(sep).join('/'),
      content: await readFile(join(dir, path), 'utf8'),
    })),
  );
}

const isHidden = (path: string) => path.split(sep).some((segment) => segment.startsWith('.'));
