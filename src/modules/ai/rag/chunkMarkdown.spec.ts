import { chunkMarkdown, embeddingText } from './chunkMarkdown';

const options = { chunkSize: 200, chunkOverlap: 20 };

describe('chunkMarkdown', () => {
  it('returns nothing for an empty note', () => {
    expect(chunkMarkdown('Empty', '  \n\n ', options)).toEqual([]);
  });

  it('keeps a short note without headings as one chunk under the title', () => {
    expect(chunkMarkdown('Groceries', 'milk, eggs', options)).toEqual([
      { headingPath: 'Groceries', content: 'milk, eggs' },
    ]);
  });

  it('splits by headings and tracks the heading path', () => {
    const md = [
      'Intro',
      '# Deploy',
      'Steps',
      '## Docker',
      'compose up',
      '### Volumes',
      'keep data',
      '## Prisma',
      'migrate deploy',
      '# Other',
      'x',
    ].join('\n');

    expect(chunkMarkdown('Ops', md, options).map((c) => c.headingPath)).toEqual([
      'Ops',
      'Ops > Deploy',
      'Ops > Deploy > Docker',
      'Ops > Deploy > Docker > Volumes',
      'Ops > Deploy > Prisma',
      'Ops > Other',
    ]);
  });

  it('keeps the heading line in the chunk content', () => {
    const [chunk] = chunkMarkdown('T', '## Setup\nrun it', options);
    expect(chunk.content).toBe('## Setup\nrun it');
  });

  it('keeps a trailing # that is part of the heading text, strips closing sequences', () => {
    const md = '## Learning C#\nnotes\n## Closed ##\nmore';
    expect(chunkMarkdown('T', md, options).map((c) => c.headingPath)).toEqual([
      'T > Learning C#',
      'T > Closed',
    ]);
  });

  it('ignores headings inside code blocks', () => {
    const md = '# Bash\n```sh\n# not a heading\necho hi\n```';
    const chunks = chunkMarkdown('T', md, options);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('T > Bash');
  });

  it('uses "Untitled" for notes without a title', () => {
    expect(chunkMarkdown(' ', 'text', options)[0].headingPath).toBe('Untitled');
  });

  it('splits long sections by paragraphs within chunkSize, with overlap', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `P${i} ${'x'.repeat(70)}`);
    const chunks = chunkMarkdown('T', paragraphs.join('\n\n'), options);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(options.chunkSize));
    // Every paragraph ends up in some chunk.
    paragraphs.forEach((p) => expect(chunks.some((c) => c.content.includes(p))).toBe(true));
    // The next chunk starts with the tail of the previous one.
    expect(chunks[1].content.startsWith(chunks[0].content.slice(-options.chunkOverlap))).toBe(true);
  });

  it('hard-splits a paragraph longer than chunkSize', () => {
    const chunks = chunkMarkdown('T', 'y'.repeat(450), options);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(options.chunkSize));
    expect(chunks.map((c) => c.content).join('').length).toBeGreaterThanOrEqual(450);
  });
});

describe('embeddingText', () => {
  it('prefixes the content with the heading path', () => {
    expect(embeddingText({ headingPath: 'A > B', content: 'text' })).toBe('A > B\n\ntext');
  });
});
