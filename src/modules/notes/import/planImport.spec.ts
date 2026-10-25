import { MAX_CONTENT_LENGTH } from '../consts/validator.consts';
import { ImportFileInput, ImportPlanError, planImport } from './planImport';

const sequentialIds = () => {
  let next = 0;
  return () => `id-${next++}`;
};

const plan = (files: ImportFileInput[], mode: 'files' | 'split-h1' = 'files') =>
  planImport({ files, mode, rootTitle: 'Import: Obsidian 2026-10-25' }, sequentialIds());

const file = (path: string, content = `text of ${path}`): ImportFileInput => ({ path, content });

describe('planImport', () => {
  it('creates a root note with the files and folders under it', () => {
    const { notes, report } = plan([file('Projects/Docker.md', '# Docker'), file('Inbox.md')]);

    expect(notes).toEqual([
      { id: 'id-0', parentId: null, title: 'Import: Obsidian 2026-10-25', content: '', order: 0 },
      { id: 'id-1', parentId: 'id-0', title: 'Inbox', content: 'text of Inbox.md', order: 1 },
      { id: 'id-2', parentId: 'id-0', title: 'Projects', content: '', order: 2 },
      { id: 'id-3', parentId: 'id-2', title: 'Docker', content: '# Docker', order: 3 },
    ]);
    expect(report).toEqual({ created: 4, skipped: [], warnings: [] });
  });

  it('gives the same plan for shuffled input', () => {
    const files = [
      file('b.md', '[[a]]'),
      file('A/x.md'),
      file('a.md', '[[b]]'),
      file('A/y.md'),
      file('A.md'),
      file('pic.png'),
    ];
    const reference = plan(files);

    for (let i = 0; i < 5; i++) {
      const shuffled = [...files].sort(() => Math.random() - 0.5);
      expect(plan(shuffled)).toEqual(reference);
    }
  });

  it('never points a parentId outside the plan, except the root', () => {
    const { notes } = plan([file('a/b/c.md'), file('a/d.md'), file('e.md'), file('a/b.md')]);
    const ids = new Set(notes.map((note) => note.id));

    expect(notes.filter((note) => note.parentId === null)).toHaveLength(1);
    notes.forEach((note) => note.parentId && expect(ids.has(note.parentId)).toBe(true));
  });

  it.each([
    ['photo.png', 'not-markdown'],
    ['.obsidian/app.md', 'hidden'],
    ['../escape.md', 'invalid-path'],
  ] as const)('skips %s as %s', (path, reason) => {
    const { notes, report } = plan([file(path), file('ok.md')]);

    expect(notes.map((note) => note.title)).toEqual(['Import: Obsidian 2026-10-25', 'ok']);
    expect(report.skipped).toEqual([{ path, reason }]);
  });

  it('skips a binary file named .md', () => {
    expect(plan([file('bin.md', 'a\u0000b')]).report.skipped).toEqual([
      { path: 'bin.md', reason: 'binary' },
    ]);
  });

  it('skips a duplicate path, keeping one of them', () => {
    const { notes, report } = plan([file('Note.md', 'one'), file('note.md', 'two')]);

    expect(notes).toHaveLength(2);
    expect(report.skipped).toEqual([{ path: 'note.md', reason: 'duplicate-path' }]);
  });

  describe('empty files', () => {
    it('skips an empty file nothing links to', () => {
      const { notes, report } = plan([file('empty.md', '  \n'), file('ok.md')]);

      expect(notes.map((note) => note.title)).not.toContain('empty');
      expect(report.skipped).toEqual([{ path: 'empty.md', reason: 'empty' }]);
    });

    it('treats a file with only frontmatter as empty', () => {
      expect(plan([file('fm.md', '---\ntags: [a]\n---\n')]).report.skipped).toEqual([
        { path: 'fm.md', reason: 'empty' },
      ]);
    });

    it('keeps an empty file some link points to', () => {
      const { notes, report } = plan([
        file('Kubernetes.md', ''),
        file('Alpha.md', 'see [[Kubernetes]]'),
      ]);
      const kubernetes = notes.find((note) => note.title === 'Kubernetes')!;

      expect(kubernetes.content).toBe('');
      expect(notes.find((note) => note.title === 'Alpha')!.content).toBe(
        `see [Kubernetes](/notes/${kubernetes.id})`,
      );
      expect(report.skipped).toEqual([]);
    });

    it('does not keep an empty file only linking to itself', () => {
      expect(plan([file('self.md', '')]).notes).toHaveLength(1);
    });

    it('drops a folder left empty, keeps one with notes', () => {
      const { notes } = plan([file('Empty/aa.md', ''), file('Full/bb.md')]);

      expect(notes.map((note) => note.title)).toEqual([
        'Import: Obsidian 2026-10-25',
        'Full',
        'bb',
      ]);
    });

    it('keeps the orders consecutive after removing notes', () => {
      const { notes } = plan([file('a.md', ''), file('b.md'), file('c.md', ''), file('d.md')]);
      expect(notes.map((note) => note.order)).toEqual([0, 1, 2]);
    });
  });

  describe('titles and content', () => {
    it('takes the title from frontmatter and keeps the frontmatter as a yaml block', () => {
      const { notes } = plan([file('docker-notes.md', '---\ntitle: Docker\ntags: [a]\n---\nbody')]);

      expect(notes[1]).toMatchObject({
        title: 'Docker',
        content: '```yaml\ntitle: Docker\ntags: [a]\n```\n\nbody',
      });
    });

    it('gives a folder note the content and frontmatter title of its file', () => {
      const { notes } = plan([
        file('A/index.md', '---\ntitle: Area A\n---\nabout A'),
        file('A/xx.md'),
      ]);

      expect(notes[1]).toMatchObject({
        title: 'Area A',
        content: '```yaml\ntitle: Area A\n```\n\nabout A',
      });
      expect(notes[2]).toMatchObject({ parentId: notes[1].id, title: 'xx' });
    });

    it('reports title fallbacks with the file path', () => {
      const { notes, report } = plan([file('Folder/   .md', 'x'), file('A.md', 'y')]);

      expect(notes.map((note) => note.title)).toEqual(
        expect.arrayContaining(['A (import)', 'Folder']),
      );
      expect(report.warnings).toEqual(
        expect.arrayContaining([
          { path: 'A.md', kind: 'title-fallback', detail: 'A (import)' },
          { path: 'Folder/   .md', kind: 'title-fallback', detail: 'Folder' },
        ]),
      );
    });

    it('strips the Notion id from file and folder names', () => {
      const id = '0123456789abcdef0123456789abcdef';
      const { notes } = plan([file(`Area ${id}/Page ${id}.md`)]);

      expect(notes.map((note) => note.title)).toEqual([
        'Import: Obsidian 2026-10-25',
        'Area',
        'Page',
      ]);
    });

    it('imports .txt as markdown', () => {
      expect(plan([file('plain.txt', 'just text')]).notes[1]).toMatchObject({
        title: 'plain',
        content: 'just text',
      });
    });
  });

  describe('links', () => {
    it('rewrites links between imported notes with the target note title', () => {
      const { notes } = plan([
        file('Infra/docker-notes.md', '---\ntitle: Docker\n---\nx'),
        file('index.md', '[[docker-notes]] and [more](Infra/docker-notes.md)'),
      ]);
      const docker = notes.find((note) => note.title === 'Docker')!;

      expect(notes.find((note) => note.title === 'index')!.content).toBe(
        `[Docker](/notes/${docker.id}) and [more](/notes/${docker.id})`,
      );
    });

    it('resolves a link to a folder note by the folder and by its file', () => {
      const { notes } = plan([
        file('Area.md', 'about Area'),
        file('Area/xx.md', '[[Area]] [up](../Area.md)'),
      ]);
      const folder = notes.find((note) => note.title === 'Area')!;

      expect(notes.find((note) => note.title === 'xx')!.content).toBe(
        `[Area](/notes/${folder.id}) [up](/notes/${folder.id})`,
      );
    });

    it('reports link and lossy-content warnings with the file path', () => {
      const { report } = plan([
        file('aa.md', '[[missing]] [x](javascript:a) ![[pic.png]]\n\n| a |\n|---|'),
      ]);

      expect(report.warnings).toEqual([
        { path: 'aa.md', kind: 'unresolved-link', detail: '[[missing]]' },
        { path: 'aa.md', kind: 'unsafe-link', detail: 'javascript:a' },
        { path: 'aa.md', kind: 'attachment-skipped', detail: '![[pic.png]]' },
        { path: 'aa.md', kind: 'lossy-content', detail: 'table' },
        { path: 'aa.md', kind: 'lossy-content', detail: 'image' },
      ]);
    });

    it('does not report an embedded note as a lossy image', () => {
      const { report } = plan([file('aa.md', '![[bb]]'), file('bb.md')]);
      expect(report.warnings).toEqual([]);
    });

    it('fails when link rewriting makes a note too long', () => {
      const content = `${'x'.repeat(MAX_CONTENT_LENGTH - 10)} [[b]]`;

      expect(() => plan([file('a.md', content), file('b.md')])).toThrow(
        new ImportPlanError('a.md is too long after rewriting its links'),
      );
    });
  });

  describe('split-h1', () => {
    it('splits one file into notes under the root', () => {
      const { notes } = plan(
        [file('All.md', 'intro\n# CI/CD\na [[Docker]]\n# Docker\nb')],
        'split-h1',
      );

      expect(notes.map((note) => note.title)).toEqual([
        'Import: Obsidian 2026-10-25',
        'All',
        'CI/CD',
        'Docker',
      ]);
      expect(notes[2].content).toBe(`# CI/CD\na [Docker](/notes/${notes[3].id})\n`);
    });

    it('fails for more than one file', () => {
      expect(() => plan([file('a.md'), file('b.md')], 'split-h1')).toThrow(ImportPlanError);
    });

    it('skips a file that cannot be imported instead of splitting it', () => {
      expect(plan([file('a.png', '# A\nx')], 'split-h1').report.skipped).toEqual([
        { path: 'a.png', reason: 'not-markdown' },
      ]);
    });
  });

  it('pads a too short root title', () => {
    expect(
      planImport({ files: [], mode: 'files', rootTitle: 'X' }, sequentialIds()).notes[0].title,
    ).toBe('X (import)');
  });
});
