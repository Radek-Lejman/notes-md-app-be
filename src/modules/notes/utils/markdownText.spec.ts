import { buildSnippet, markdownToPlainText, toWords } from './markdownText';

describe('markdownToPlainText', () => {
  it.each([
    ['headings', '## Instalacja', 'Instalacja'],
    ['emphasis', '**bold**, *italic*, ~~strike~~ and `code`', 'bold, italic, strike and code'],
    ['lists', '- a\n  - b\n1. c\n2) d', 'a b c d'],
    ['quotes', '> cytat\n>\n> dalej', 'cytat dalej'],
    ['links (text only)', 'Zobacz [docs](https://example.com/a_b).', 'Zobacz docs.'],
    ['page references', '[Docker](/notes/3f2a9c1e-8b7d-4e6a-9f10-2c4d5e6f7a8b)', 'Docker'],
    ['code fences (keeping the code)', '```ts\nconst a = 1;\n```', 'const a = 1;'],
    ['empty-line placeholders', 'a\n\n&nbsp;\n\nb', 'a b'],
    ['hard breaks', 'a\\\nb', 'a b'],
    ['thematic breaks', 'a\n\n---\n\nb', 'a b'],
    [
      'escapes, keeping the literal characters',
      '\\*ważne\\* \\# content\\_md 1\\. x',
      '*ważne* # content_md 1. x',
    ],
  ])('strips %s', (_case, markdown, expected) => {
    expect(markdownToPlainText(markdown)).toBe(expected);
  });

  it('returns an empty string for empty markdown', () => {
    expect(markdownToPlainText('')).toBe('');
  });
});

describe('toWords', () => {
  it('lower-cases and keeps Unicode letters and digits', () => {
    expect(toWords('Zażółć GĘŚLĄ, 2026!')).toEqual(['zażółć', 'gęślą', '2026']);
  });

  it('returns no words for punctuation only', () => {
    expect(toWords('--- !!!')).toEqual([]);
  });
});

describe('buildSnippet', () => {
  const filler = (words: number) => Array.from({ length: words }, (_, i) => `słowo${i}`).join(' ');

  it('returns short notes whole, as plain text', () => {
    expect(buildSnippet('# Docker\n\nNotatki o **kontenerach**.', 'docker')).toBe(
      'Docker Notatki o kontenerach.',
    );
  });

  it('centres a long note on the first match and marks the cuts', () => {
    const markdown = `${filler(40)} **Kubernetes** ${filler(40)}`;
    const snippet = buildSnippet(markdown, 'kubernetes');

    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('Kubernetes');
    expect(snippet.length).toBeLessThanOrEqual(162);
  });

  it('matches word prefixes, like the full-text query', () => {
    expect(buildSnippet(`${filler(40)} kontenerach ${filler(40)}`, 'konten')).toContain(
      'kontenerach',
    );
  });

  it('does not match inside a word', () => {
    const snippet = buildSnippet(`${filler(40)} xdocker ${filler(40)}`, 'docker');
    expect(snippet.startsWith('słowo0')).toBe(true);
  });

  it('keeps the match when lower-casing would change the text length', () => {
    const snippet = buildSnippet(`${'İ'.repeat(200)} ${filler(40)} kubernetes ${filler(40)}`, 'kubernetes');
    expect(snippet).toContain('kubernetes');
  });

  it('starts at the beginning when nothing matches', () => {
    const snippet = buildSnippet(filler(80), 'brak');
    expect(snippet.startsWith('słowo0 ')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('never returns HTML from the note', () => {
    expect(buildSnippet('<img src=x onerror=alert(1)> \\<b>', 'img')).not.toMatch(/<img|\\</);
  });
});
