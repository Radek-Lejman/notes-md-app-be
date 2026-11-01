import { frontmatterToContent, readTitle, splitFrontmatter } from './frontmatter';

describe('splitFrontmatter', () => {
  it('returns markdown without frontmatter unchanged', () => {
    expect(splitFrontmatter('# Docker\n\ntext')).toEqual({
      frontmatter: null,
      body: '# Docker\n\ntext',
    });
  });

  it('extracts a closed block from the first line', () => {
    expect(splitFrontmatter('---\ntitle: X\ntags: [a]\n---\ncontent')).toEqual({
      frontmatter: 'title: X\ntags: [a]',
      body: 'content',
    });
  });

  it('accepts `...` as the closing line and trailing spaces on the delimiters', () => {
    expect(splitFrontmatter('--- \ntitle: X\n...  \ncontent')).toEqual({
      frontmatter: 'title: X',
      body: 'content',
    });
  });

  it('extracts an empty block', () => {
    expect(splitFrontmatter('---\n---\ncontent')).toEqual({ frontmatter: '', body: 'content' });
  });

  it('closes at the first delimiter, not at a later thematic break', () => {
    expect(splitFrontmatter('---\n---\ntext\n---\nmore')).toEqual({
      frontmatter: '',
      body: 'text\n---\nmore',
    });
    expect(splitFrontmatter('---\na: 1\n---\ntext\n---')).toEqual({
      frontmatter: 'a: 1',
      body: 'text\n---',
    });
  });

  it('extracts a block that ends the file', () => {
    expect(splitFrontmatter('---\ntitle: X\n---')).toEqual({ frontmatter: 'title: X', body: '' });
  });

  it.each([
    ['unclosed', '---\ntitle: X\ncontent'],
    ['not on the first line', '\n---\ntitle: X\n---\ncontent'],
    ['a thematic break with text after it', '---text\ntitle: X\n---'],
  ])('leaves %s frontmatter in the body', (_case, markdown) => {
    expect(splitFrontmatter(markdown)).toEqual({ frontmatter: null, body: markdown });
  });
});

describe('readTitle', () => {
  it.each([
    ['title: X', 'X'],
    ['tags: [a]\ntitle:   Docker  \nother: 1', 'Docker'],
    ['title: "X: y"', 'X: y'],
    ["title: 'it''s'", "it's"],
    ['title: "say \\"hi\\" \\\\ ok"', 'say "hi" \\ ok'],
    ['title: Plan # a comment', 'Plan'],
    ['title: C# basics', 'C# basics'],
  ])('%j -> %j', (frontmatter, title) => {
    expect(readTitle(frontmatter)).toBe(title);
  });

  it.each([
    ['no title', 'tags: [a]'],
    ['an empty title', 'title:'],
    ['an empty quoted title', 'title: ""'],
    ['a nested key', 'meta:\n  title: X'],
    ['a block scalar', 'title: |\n  X'],
    ['a folded scalar', 'title: >\n  X'],
    ['a flow sequence', 'title: [a, b]'],
    ['a flow mapping', 'title: {a: b}'],
  ])('returns null for %s', (_case, frontmatter) => {
    expect(readTitle(frontmatter)).toBeNull();
  });
});

describe('frontmatterToContent', () => {
  it('returns the body when there is no frontmatter', () => {
    expect(frontmatterToContent(null, 'text')).toBe('text');
  });

  it('puts the frontmatter (with title:) in a yaml code block before the body', () => {
    expect(frontmatterToContent('title: Docker\ntags: [docker]', 'text')).toBe(
      '```yaml\ntitle: Docker\ntags: [docker]\n```\n\ntext',
    );
  });

  it('drops leading blank lines of the body', () => {
    expect(frontmatterToContent('a: 1', '\n\ntext')).toBe('```yaml\na: 1\n```\n\ntext');
  });

  it('keeps only the block when the body is empty', () => {
    expect(frontmatterToContent('a: 1', '  \n')).toBe('```yaml\na: 1\n```');
  });

  it('drops a blank frontmatter', () => {
    expect(frontmatterToContent(' \n', 'text')).toBe('text');
  });

  it('uses a longer fence when the frontmatter contains backticks', () => {
    expect(frontmatterToContent('a: "```"', 'text')).toBe('````yaml\na: "```"\n````\n\ntext');
  });
});
