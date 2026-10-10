import { compareContent, markdownToWords } from './contentMdVerify';
import { doc, h, p, pageRef, text } from '../testing/tiptap.builders';

describe('markdownToWords', () => {
  it('strips block and inline syntax, keeping words in document order', () => {
    const md = '# Tytuł\n\n- **pogrubiony** tekst\n> cytat\n\n```ts\nconst x\n```';
    expect(markdownToWords(md)).toEqual(['tytuł', 'pogrubiony', 'tekst', 'cytat', 'const', 'x']);
  });

  it('keeps the link text and drops the URL', () => {
    expect(markdownToWords('[Dokumentacja](https://docs.example.com/page)')).toEqual([
      'dokumentacja',
    ]);
  });

  it('treats escaped characters as plain text', () => {
    expect(markdownToWords('\\*ważne\\* \\# tag')).toEqual(['ważne', 'tag']);
  });

  it('normalizes case and whitespace but keeps repeated words', () => {
    expect(markdownToWords('Hello   WORLD\n\nhello')).toEqual(['hello', 'world', 'hello']);
  });

  it('keeps Polish characters and digits', () => {
    expect(markdownToWords('Zażółć 2026 gęślą')).toEqual(['zażółć', '2026', 'gęślą']);
  });

  it('returns no words for empty markdown', () => {
    expect(markdownToWords('')).toEqual([]);
  });
});

describe('compareContent', () => {
  it('passes when JSON and markdown contain the same words', () => {
    const json = doc(h(1, text('Title')), p(text('Hello', 'bold'), text(' world')));
    expect(compareContent(json, '# Title\n\n**Hello** world')).toEqual({
      ok: true,
      missing: [],
      extra: [],
    });
  });

  it('reports words lost during conversion', () => {
    const json = doc(p(text('alpha beta gamma')));
    expect(compareContent(json, 'alpha gamma')).toEqual({
      ok: false,
      missing: ['beta'],
      extra: [],
    });
  });

  it('counts repeated words, not just distinct ones', () => {
    expect(compareContent(doc(p(text('a a'))), 'a')).toMatchObject({ ok: false, missing: ['a'] });
  });

  it('reports extra words without failing (e.g. page reference titles)', () => {
    const json = doc(p(text('see')), pageRef('3f2a9c1e-8b7d-4e6a-9f10-2c4d5e6f7a8b', 'Docker'));
    expect(
      compareContent(json, 'see\n\n[Docker](/notes/3f2a9c1e-8b7d-4e6a-9f10-2c4d5e6f7a8b)'),
    ).toEqual({
      ok: true,
      missing: [],
      extra: ['docker'],
    });
  });

  it('passes for an empty note', () => {
    expect(compareContent(null, '')).toEqual({ ok: true, missing: [], extra: [] });
  });
});
