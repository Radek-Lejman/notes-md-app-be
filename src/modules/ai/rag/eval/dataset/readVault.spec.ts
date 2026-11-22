import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVault } from './readVault';

describe('readVault', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(dir, 'projects/zdrowie'), { recursive: true });
    await mkdir(join(dir, '.obsidian'));
    await writeFile(join(dir, 'root.md'), '# Root');
    await writeFile(join(dir, 'projects/zdrowie/Sen.md'), 'sen');
    await writeFile(join(dir, 'projects/image.png'), 'png');
    await writeFile(join(dir, '.obsidian/workspace.md'), 'state');
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('returns importable files with vault-relative slash paths, skipping dot folders', async () => {
    const files = await readVault(dir);

    expect(files.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'projects/zdrowie/Sen.md', content: 'sen' },
      { path: 'root.md', content: '# Root' },
    ]);
  });
});
