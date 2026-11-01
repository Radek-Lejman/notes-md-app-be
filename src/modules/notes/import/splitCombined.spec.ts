import { splitByH1 } from './splitCombined';

describe('splitByH1', () => {
  it('splits three H1s into three sections, keeping the heading in the content', () => {
    expect(splitByH1('# A1\na\n\n# B1\nb\n# C1\nc', 'Combined.md')).toEqual([
      { path: 'A1.md', title: 'A1', content: '# A1\na\n' },
      { path: 'B1.md', title: 'B1', content: '# B1\nb\n' },
      { path: 'C1.md', title: 'C1', content: '# C1\nc' },
    ]);
  });

  it('makes the text before the first H1 a note named after the file', () => {
    expect(splitByH1('intro\n\n# A1\na', 'My notes.md')).toEqual([
      { path: 'My notes.md', title: 'My notes', content: 'intro\n' },
      { path: 'A1.md', title: 'A1', content: '# A1\na' },
    ]);
  });

  it('skips a blank intro', () => {
    expect(splitByH1('\n  \n# A1\na', 'x.md').map((s) => s.title)).toEqual(['A1']);
  });

  it('returns the whole file when there is no H1', () => {
    expect(splitByH1('## H2\ntext', 'Notes.md')).toEqual([
      { path: 'Notes.md', title: 'Notes', content: '## H2\ntext' },
    ]);
  });

  it('does not split on # in a code block, on H2 or on #hashtags', () => {
    const markdown = '# A1\n```sh\n# comment\n```\n## H2\n#tag\n    # indented';
    expect(splitByH1(markdown, 'x.md')).toHaveLength(1);
  });

  it('strips closing hashes and inline markdown from the title', () => {
    expect(splitByH1('# **Bold** [link](x.md) ##\ntext', 'x.md')[0].title).toBe('Bold link');
  });

  it('keeps a slash in the title but not in the path', () => {
    expect(splitByH1('# CI/CD\ntext', 'x.md')[0]).toMatchObject({
      path: 'CI-CD.md',
      title: 'CI/CD',
    });
  });

  it('does not produce hidden paths', () => {
    expect(splitByH1('# .NET\ntext', 'x.md')[0]).toMatchObject({ path: 'NET.md', title: '.NET' });
  });

  it('makes paths of duplicate (also case-insensitive) titles unique', () => {
    expect(splitByH1('# Log\na\n# log\nb\n# Log\nc', 'x.md').map((s) => s.path)).toEqual([
      'Log.md',
      'log (2).md',
      'Log (3).md',
    ]);
  });

  it('names an empty heading "Untitled"', () => {
    expect(splitByH1('#\ntext', 'x.md')[0]).toMatchObject({ path: 'Untitled.md', title: '' });
  });

  it('accepts up to three spaces before the hash', () => {
    expect(splitByH1('   # A1\na', 'x.md')[0].title).toBe('A1');
  });
});
