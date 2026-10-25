import { createLinkIndex, LinkTarget, resolveLinks } from './resolveLinks';

const target = (id: string, path: string, title: string): LinkTarget => ({
  id,
  segments: path.split('/'),
  title,
});

const targets = [
  target('docker', 'Infra/Docker.md', 'Docker'),
  target('my-note', 'My Note.md', 'My Note'),
  target('readme-root', 'readme.md', 'Readme'),
  target('readme-infra', 'Infra/readme.md', 'Infra readme'),
  target('plan-a', 'A/Plan.md', 'Plan A'),
  target('plan-b', 'B/Plan.md', 'Plan B'),
  target('projects', 'Projects', 'Projects'),
  target('tricky', 'Infra/Tricky.md', 'a]b *c*'),
  target('zolw', 'Żółw.md', 'Żółw'),
  target('notes-txt', 'Plain.txt', 'Plain'),
];
const index = createLinkIndex(targets);
const source = { id: 'source', segments: ['Infra', 'Source.md'], title: 'Source' };

const resolve = (markdown: string, from = source) => resolveLinks(markdown, from, index);

describe('resolveLinks', () => {
  describe('wiki links', () => {
    it.each([
      ['[[Docker]]', '[Docker](/notes/docker)'],
      ['[[docker]]', '[Docker](/notes/docker)'],
      ['[[Docker|containers]]', '[containers](/notes/docker)'],
      ['| [[Docker\\|containers]] |', '| [containers](/notes/docker) |'],
      ['[[Docker#Networks]]', '[Docker › Networks](/notes/docker)'],
      ['[[Docker#^block-id]]', '[Docker](/notes/docker)'],
      ['[[Docker#Networks|nets]]', '[nets](/notes/docker)'],
      ['![[Docker]]', '[Docker](/notes/docker)'],
      ['[[Infra/Docker]]', '[Docker](/notes/docker)'],
      ['[[Docker.md]]', '[Docker](/notes/docker)'],
      ['[[Plain]]', '[Plain](/notes/notes-txt)'],
      ['[[Projects]]', '[Projects](/notes/projects)'],
      ['[[Tricky]]', '[a\\]b \\*c\\*](/notes/tricky)'],
      ['[[Docker|a_b]]', '[a\\_b](/notes/docker)'],
    ])('%s -> %s', (markdown, expected) => {
      expect(resolve(markdown).content).toBe(expected);
    });

    it('links to the source note itself for a heading-only link', () => {
      expect(resolve('[[#Intro]]').content).toBe('[Source › Intro](/notes/source)');
    });

    it('matches NFD link text against NFC paths', () => {
      expect(resolve('[[Żółw]]'.normalize('NFD')).content).toBe('[Żółw](/notes/zolw)');
    });

    it('leaves an unresolved link unchanged and reports it', () => {
      const result = resolve('see [[No such note]]');

      expect(result.content).toBe('see [[No such note]]');
      expect(result.warnings).toEqual([{ kind: 'unresolved-link', detail: '[[No such note]]' }]);
    });

    it.each(['![[diagram.png]]', '[[report.pdf]]', '![[missing]]'])(
      'reports %s as a skipped attachment',
      (markdown) => {
        const result = resolve(markdown);

        expect(result.content).toBe(markdown);
        expect(result.warnings).toEqual([{ kind: 'attachment-skipped', detail: markdown }]);
      },
    );

    it('records the linked notes', () => {
      expect([...resolve('[[Docker]] [[My Note]] [[nope]]').linkedIds]).toEqual([
        'docker',
        'my-note',
      ]);
    });
  });

  describe('resolution order', () => {
    it('prefers the path relative to the source file', () => {
      expect(resolve('[x](readme.md)').content).toBe('[x](/notes/readme-infra)');
    });

    it('falls back to the path from the import root', () => {
      expect(resolve('[x](My%20Note.md)').content).toBe('[x](/notes/my-note)');
    });

    it('resolves ../ from the source folder', () => {
      expect(resolve('[x](../readme.md)').content).toBe('[x](/notes/readme-root)');
    });

    it('matches a path suffix', () => {
      expect(resolve('[[A/Plan]]').content).toBe('[Plan A](/notes/plan-a)');
    });

    it('picks the shortest path, then the first, for an ambiguous base name', () => {
      const plan = resolve('[[Plan]]');
      expect(plan.content).toBe('[Plan A](/notes/plan-a)');
      expect(plan.warnings).toEqual([{ kind: 'ambiguous-link', detail: '[[Plan]]' }]);

      const readme = resolve('[[readme]]', { id: 's', segments: ['Other', 'S.md'], title: 'S' });
      expect(readme.content).toBe('[Readme](/notes/readme-root)');
    });

    it('does not resolve a path climbing above the root', () => {
      expect(resolve('[x](../../Docker.md)').warnings[0].kind).toBe('unresolved-link');
    });
  });

  describe('markdown links', () => {
    it.each([
      ['[desc](Docker.md)', '[desc](/notes/docker)'],
      ['[desc](../Infra/Docker.md)', '[desc](/notes/docker)'],
      ['[desc](<../My Note.md>)', '[desc](/notes/my-note)'],
      ['[desc](Docker.md#networks)', '[desc](/notes/docker)'],
      ['[desc](Docker.md "title")', '[desc](/notes/docker)'],
      ['[desc](Docker)', '[desc](/notes/docker)'],
      ['![alt](Docker.md)', '[alt](/notes/docker)'],
      ['[a\\]b *c*](Docker.md)', '[a\\]b *c*](/notes/docker)'],
      ['[`npm` docs](Docker.md)', '[`npm` docs](/notes/docker)'],
    ])('%s -> %s', (markdown, expected) => {
      expect(resolve(markdown).content).toBe(expected);
    });

    it.each([
      '[x](https://example.com/a.md)',
      '[x](http://example.com)',
      '[x](mailto:a@b.c)',
      '[x](#heading)',
      '[x](/notes/3f2a9c1e-8b7d-4e6a-9f10-2c4d5e6f7a8b)',
      '[x]()',
      '<https://example.com>',
    ])('leaves %s unchanged without warnings', (markdown) => {
      expect(resolve(markdown)).toEqual({ content: markdown, warnings: [], linkedIds: new Set() });
    });

    it.each(['![](img/a.png)', '[report](files/report.pdf)'])(
      'reports %s as a skipped attachment',
      (markdown) => {
        const result = resolve(markdown);

        expect(result.content).toBe(markdown);
        expect(result.warnings).toEqual([{ kind: 'attachment-skipped', detail: markdown }]);
      },
    );

    it('reports an unresolved relative link', () => {
      expect(resolve('[x](missing.md)').warnings).toEqual([
        { kind: 'unresolved-link', detail: '[x](missing.md)' },
      ]);
    });

    it('resolves reference definitions', () => {
      expect(resolve('[x][d]\n\n[d]: Docker.md "t"').content).toBe(
        '[x][d]\n\n[d]: /notes/docker "t"',
      );
      expect(resolve('[Docker.md]: Docker.md').content).toBe('[Docker.md]: /notes/docker');
    });
  });

  describe('unsafe links', () => {
    it.each([
      ['[x](javascript:alert(1))', 'x'],
      ['[x](JavaScript:alert(1))', 'x'],
      ['[x](data:text/html;base64,AAA)', 'x'],
      ['[x](vbscript:msgbox)', 'x'],
      ['[x](java&#115;cript:alert(1))', 'x'],
      ['[x](java&#x73;cript:alert(1))', 'x'],
      ['[x](javascript&colon;alert(1))', 'x'],
      ['[x](<java\tscript:alert(1)>)', 'x'],
      ['[x](obsidian://open?vault=a)', 'x'],
      ['[x](java&unknown;script:a)', 'x'],
      ['![alt](javascript:alert(1))', 'alt'],
      ['[**bold**](javascript:a)', '**bold**'],
      ['<javascript:alert(1)>', 'javascript:alert(1)'],
    ])('%s -> %s', (markdown, expected) => {
      const result = resolve(markdown);

      expect(result.content).toBe(expected);
      expect(result.warnings.map((warning) => warning.kind)).toEqual(['unsafe-link']);
    });

    it('neutralizes an unsafe reference definition', () => {
      const result = resolve('[x][d]\n\n[d]: javascript:alert(1)');

      expect(result.content).toBe('[x][d]\n\n[d]: #');
      expect(result.warnings).toEqual([{ kind: 'unsafe-link', detail: 'javascript:alert(1)' }]);
    });
  });

  describe('code', () => {
    it('leaves links in code untouched', () => {
      const markdown = '`[[Docker]]`\n\n```\n[x](javascript:a) [[Docker]]\n```\n\n    [[Docker]]';
      expect(resolve(markdown)).toEqual({ content: markdown, warnings: [], linkedIds: new Set() });
    });
  });

  it('rewrites a standalone line, a list item and an inline link alike', () => {
    // The editor turns only the standalone line into a pageReference block (FE fixture
    // 04-page-reference.md); the list item and the inline link stay regular links.
    expect(resolve('[[Docker]]\n\n- [[Docker]]\n\nSee [[Docker]] now.').content).toBe(
      '[Docker](/notes/docker)\n\n- [Docker](/notes/docker)\n\nSee [Docker](/notes/docker) now.',
    );
  });

  it('truncates long warning details', () => {
    const name = 'x'.repeat(500);
    expect(resolve(`[[${name}]]`).warnings[0].detail).toHaveLength(200);
  });
});
