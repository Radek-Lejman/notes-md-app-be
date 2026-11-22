import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexCache, indexFingerprint, readIndexCache, writeIndexCache } from './indexCache';

const settings = { embeddingModel: 'bge-m3', chunkSize: 1500, chunkOverlap: 200 };
const files = [
  { path: 'b.md', content: 'B' },
  { path: 'a.md', content: 'A' },
];

describe('indexFingerprint', () => {
  const base = indexFingerprint(files, settings);

  it('does not depend on the file order', () => {
    expect(indexFingerprint([...files].reverse(), settings)).toBe(base);
  });

  it('changes with content, path or an index setting', () => {
    expect(indexFingerprint([files[0], { path: 'a.md', content: 'A!' }], settings)).not.toBe(base);
    expect(indexFingerprint([files[0], { path: 'c.md', content: 'A' }], settings)).not.toBe(base);
    expect(indexFingerprint(files, { ...settings, chunkSize: 1000 })).not.toBe(base);
  });

  it('ignores search-time settings passed along', () => {
    const evalConfig = { ...settings, minScore: 0.3, topK: 10, hybrid: false };
    expect(indexFingerprint(files, evalConfig)).toBe(base);
  });

  it('does not let content leak into the next path', () => {
    const glued = [{ path: 'a.md', content: 'x\0b.md\0y' }];
    const split = [
      { path: 'a.md', content: 'x' },
      { path: 'b.md', content: 'y' },
    ];
    expect(indexFingerprint(glued, settings)).not.toBe(indexFingerprint(split, settings));
  });
});

describe('index cache file', () => {
  let dir: string;
  const cache: IndexCache = {
    fingerprint: 'f',
    userId: 'u',
    noteCount: 3,
    idByPath: { 'a.md': 'n1' },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'index-cache-'));
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('round-trips, creating the folder', async () => {
    const file = join(dir, 'nested/.cache/index.json');
    await writeIndexCache(file, cache);

    expect(await readIndexCache(file)).toEqual(cache);
  });

  it('reads a missing or invalid cache as null', async () => {
    const file = join(dir, 'index.json');
    expect(await readIndexCache(file)).toBeNull();

    await writeFile(file, '{"fingerprint": 1}');
    expect(await readIndexCache(file)).toBeNull();
  });
});
