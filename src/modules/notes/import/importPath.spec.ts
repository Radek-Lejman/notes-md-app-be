import { isImportablePath, normalizeImportPath } from './importPath';

describe('normalizeImportPath', () => {
  it.each([
    ['Docker.md', ['Docker.md']],
    ['Projects/Docker.md', ['Projects', 'Docker.md']],
    ['Projects\\Infra\\Docker.md', ['Projects', 'Infra', 'Docker.md']],
    ['  Projects / Docker.md', ['  Projects ', ' Docker.md']],
  ])('%j -> segments %j', (path, segments) => {
    expect(normalizeImportPath(path)).toEqual({ ok: true, segments });
  });

  it('normalizes NFD (macOS file names) to NFC', () => {
    const nfd = 'Zażółć/Gęś.md'.normalize('NFD');
    const result = normalizeImportPath(nfd);

    expect(result).toEqual({ ok: true, segments: ['Zażółć', 'Gęś.md'] });
    expect(result.ok && result.segments[0]).toBe('Zażółć'.normalize('NFC'));
  });

  it.each([
    ['empty', ''],
    ['parent segment', '../x.md'],
    ['parent segment in the middle', 'a/../x.md'],
    ['current-directory segment', './x.md'],
    ['absolute unix path', '/etc/x.md'],
    ['absolute windows path', 'C:/x.md'],
    ['absolute windows path with backslashes', 'C:\\x.md'],
    ['empty segment', 'a//b.md'],
    ['trailing slash', 'a/'],
    ['whitespace-only segment', 'a/ /b.md'],
    ['control character', 'a\u0000b.md'],
  ])('rejects %s as invalid-path', (_case, path) => {
    expect(normalizeImportPath(path)).toEqual({ ok: false, reason: 'invalid-path' });
  });

  it.each(['.obsidian/workspace.md', 'Notes/.trash/old.md', '.DS_Store', 'a/.hidden.md'])(
    'marks %j as hidden',
    (path) => {
      expect(normalizeImportPath(path)).toEqual({ ok: false, reason: 'hidden' });
    },
  );

  it('reports invalid-path before hidden', () => {
    expect(normalizeImportPath('.obsidian/../x.md')).toEqual({ ok: false, reason: 'invalid-path' });
  });
});

describe('isImportablePath', () => {
  it.each(['a.md', 'A.MD', 'notes/a.markdown', 'plain.txt', 'Plain.TXT'])('%j -> true', (path) => {
    expect(isImportablePath(path)).toBe(true);
  });

  it.each(['a.png', 'a.pdf', 'md', 'a.md.png', 'a.mdx', 'notes.md/image.png'])(
    '%j -> false',
    (path) => {
      expect(isImportablePath(path)).toBe(false);
    },
  );
});
