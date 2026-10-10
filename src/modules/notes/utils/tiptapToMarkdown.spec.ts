import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tiptapToMarkdown, TiptapNode } from './tiptapToMarkdown';
import {
  br,
  codeBlock,
  doc,
  h,
  hr,
  li,
  link,
  ol,
  p,
  pageRef,
  quote,
  text,
  ul,
} from '../testing/tiptap.builders';

const toMd = (...blocks: TiptapNode[]) => tiptapToMarkdown(doc(...blocks)).markdown;
const emptyReport = { droppedMarks: {}, unknownNodes: {} };
const NOTE_ID = '3f2a9c1e-8b7d-4e6a-9f10-2c4d5e6f7a8b';

describe('tiptapToMarkdown', () => {
  describe('empty input', () => {
    it.each<[string, TiptapNode | null | undefined]>([
      ['null', null],
      ['undefined', undefined],
      ['a doc without content', { type: 'doc' }],
      ['a doc with an empty paragraph', doc(p())],
    ])('returns empty markdown and an empty report for %s', (_case, input) => {
      expect(tiptapToMarkdown(input)).toEqual({ markdown: '', report: emptyReport });
    });
  });

  describe('blocks', () => {
    it.each([1, 2, 3, 4, 5, 6])('renders a level %i heading', (level) => {
      expect(toMd(h(level, text('Title')))).toBe(`${'#'.repeat(level)} Title`);
    });

    it('separates blocks with one blank line', () => {
      expect(toMd(p(text('a')), p(text('b')))).toBe('a\n\nb');
    });

    it('keeps intentional empty lines as &nbsp;, like the editor', () => {
      expect(toMd(p(text('a')), p(), p(text('b')))).toBe('a\n\n&nbsp;\n\nb');
    });

    it("drops trailing empty paragraphs (the editor's trailing node)", () => {
      expect(toMd(p(text('a')), p(), p())).toBe('a');
    });

    it('renders a bullet list', () => {
      expect(toMd(ul(li(p(text('a'))), li(p(text('b')))))).toBe('- a\n- b');
    });

    it('renders an ordered list starting at attrs.start', () => {
      expect(toMd(ol(3, li(p(text('a'))), li(p(text('b')))))).toBe('3. a\n4. b');
    });

    it('defaults an ordered list without attrs to start at 1', () => {
      expect(toMd({ type: 'orderedList', content: [li(p(text('a')))] })).toBe('1. a');
    });

    it('indents nested bullet lists by the parent marker width', () => {
      const nested = ul(li(p(text('a')), ul(li(p(text('b')), ul(li(p(text('c'))))))));
      expect(toMd(nested)).toBe('- a\n  - b\n    - c');
    });

    // The editor indents every level by 2 spaces, also under `1.` (its own parser reads it back).
    it('indents content nested in an ordered list by 2 spaces, like the editor', () => {
      expect(toMd(ol(1, li(p(text('a')), ul(li(p(text('b')))))))).toBe('1. a\n  - b');
    });

    it('prefixes every line of a blockquote, including blank ones', () => {
      expect(toMd(quote(p(text('a')), p(text('b'))))).toBe('> a\n>\n> b');
    });

    it('renders a code block with a language', () => {
      expect(toMd(codeBlock('ts', 'const a = 1;'))).toBe('```ts\nconst a = 1;\n```');
    });

    it('renders a code block without a language', () => {
      expect(toMd(codeBlock(null, 'x'))).toBe('```\nx\n```');
    });

    it('uses a longer fence when the code itself contains a fence', () => {
      expect(toMd(codeBlock(null, '```\ninner\n```'))).toBe('````\n```\ninner\n```\n````');
    });

    it('renders a horizontal rule', () => {
      expect(toMd(p(text('a')), hr(), p(text('b')))).toBe('a\n\n---\n\nb');
    });

    it('renders a hard break as a backslash line break', () => {
      expect(toMd(p(text('a'), br(), text('b')))).toBe('a\\\nb');
    });
  });

  describe('marks', () => {
    it.each([
      ['bold', '**a**'],
      ['italic', '*a*'],
      ['strike', '~~a~~'],
      ['code', '`a`'],
    ])('renders %s', (mark, expected) => {
      expect(toMd(p(text('a', mark)))).toBe(expected);
    });

    it('nests bold and italic', () => {
      expect(toMd(p(text('a', 'bold', 'italic')))).toBe('***a***');
    });

    it('renders a link', () => {
      expect(toMd(p(text('docs', link('https://example.com'))))).toBe(
        '[docs](https://example.com)',
      );
    });

    it('wraps a link in other marks, like the editor', () => {
      expect(toMd(p(text('docs', link('https://example.com'), 'bold')))).toBe(
        '**[docs](https://example.com)**',
      );
    });

    it('formats only the marked fragment', () => {
      expect(toMd(p(text('a '), text('b', 'bold'), text(' c')))).toBe('a **b** c');
    });

    it('merges adjacent text nodes sharing a mark', () => {
      expect(toMd(p(text('a', 'bold'), text('b', 'bold')))).toBe('**ab**');
    });

    it('moves whitespace at mark edges outside the delimiters', () => {
      expect(toMd(p(text('bold ', 'bold'), text('x')))).toBe('**bold** x');
    });
  });

  describe('escaping', () => {
    it.each([
      ['emphasis characters', '*ważne* _też_', '\\*ważne\\* \\_też\\_'],
      ['brackets', '[nawias]', '\\[nawias\\]'],
      ['backticks', 'użyj `npm`', 'użyj \\`npm\\`'],
      ['backslashes', 'C:\\temp', 'C:\\\\temp'],
      ['a heading marker at line start', '# nie nagłówek', '\\# nie nagłówek'],
      ['an ordered list marker at line start', '1. nie lista', '1\\. nie lista'],
      ['a bullet marker at line start', '- nie lista', '\\- nie lista'],
      ['a blockquote marker at line start', '> nie cytat', '\\> nie cytat'],
      ['strike markers', '~~nie~~', '\\~\\~nie\\~\\~'],
      ['an HTML tag', '<div>', '\\<div>'],
      ['an HTML entity', '&nbsp; tekst', '\\&nbsp; tekst'],
    ])('escapes %s in plain text', (_case, input, expected) => {
      expect(toMd(p(text(input)))).toBe(expected);
    });

    it.each(['C# jest ok', '2 - 1 = 1', 'a > b', 'rok 2026. koniec'])(
      'does not escape %j where markers are not at line start',
      (input) => {
        expect(toMd(p(text(input)))).toBe(input);
      },
    );

    it('escapes line-start markers after a hard break', () => {
      expect(toMd(p(text('a'), br(), text('# b')))).toBe('a\\\n\\# b');
    });

    it('does not escape inside a code block', () => {
      expect(toMd(codeBlock(null, '*a* # b [c]'))).toBe('```\n*a* # b [c]\n```');
    });

    it('does not escape inside inline code', () => {
      expect(toMd(p(text('*a*', 'code')))).toBe('`*a*`');
    });

    it('escapes the link text but leaves the URL alone', () => {
      expect(toMd(p(text('a*b', link('https://x.com/a_b'))))).toBe('[a\\*b](https://x.com/a_b)');
    });
  });

  describe('pageReference', () => {
    it('renders a page reference as a standalone link to the note', () => {
      expect(toMd(p(text('a')), pageRef(NOTE_ID, 'Docker'), p(text('b')))).toBe(
        `a\n\n[Docker](/notes/${NOTE_ID})\n\nb`,
      );
    });

    it('escapes brackets in the referenced title', () => {
      expect(toMd(pageRef(NOTE_ID, 'Plan [v2]'))).toBe(`[Plan \\[v2\\]](/notes/${NOTE_ID})`);
    });

    it.each([null, ''])('falls back to "Untitled" when the title is %j', (title) => {
      expect(toMd(pageRef(NOTE_ID, title))).toBe(`[Untitled](/notes/${NOTE_ID})`);
    });

    it('does not report page references as unknown nodes', () => {
      expect(tiptapToMarkdown(doc(pageRef(NOTE_ID, 'Docker'))).report).toEqual(emptyReport);
    });
  });

  describe('lossy content report', () => {
    it.each([
      ['underline', { type: 'underline' }],
      ['textStyle', { type: 'textStyle', attrs: { color: '#ff0000' } }],
      ['highlight', { type: 'highlight' }],
    ])('drops the %s mark, keeps its text and reports it', (name, mark) => {
      expect(tiptapToMarkdown(doc(p(text('a', mark))))).toEqual({
        markdown: 'a',
        report: { droppedMarks: { [name]: 1 }, unknownNodes: {} },
      });
    });

    it('counts every dropped mark occurrence', () => {
      const { report } = tiptapToMarkdown(
        doc(p(text('a', 'underline')), p(text('b', 'underline', 'bold'))),
      );
      expect(report.droppedMarks).toEqual({ underline: 2 });
    });

    it('keeps the text of unknown nodes and reports them', () => {
      const callout: TiptapNode = { type: 'callout', content: [p(text('uwaga'))] };
      expect(tiptapToMarkdown(doc(callout))).toEqual({
        markdown: 'uwaga',
        report: { droppedMarks: {}, unknownNodes: { callout: 1 } },
      });
    });

    it('reports nothing for fully supported content', () => {
      const { report } = tiptapToMarkdown(
        doc(h(1, text('T')), p(text('a', 'bold')), ul(li(p(text('b')))), codeBlock('ts', 'x')),
      );
      expect(report).toEqual(emptyReport);
    });
  });

  /**
   * Golden files: `<name>.json` is what the editor stored, `<name>.md` is what the editor
   * serializes it to. They are generated by the FE test (`UPDATE_GOLDEN=1 npm test` in
   * notes-app-fe, src/shared/lib/editor/markdown) and copied here, so this test proves the
   * migration writes exactly what the editor would.
   */
  describe('golden files', () => {
    const FIXTURES_DIR = join(__dirname, '__fixtures__', 'markdown');
    const fixtures = readdirSync(FIXTURES_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace(/\.json$/, ''));

    const read = (file: string) => readFileSync(join(FIXTURES_DIR, file), 'utf8');

    it('has fixtures to check', () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });

    it.each(fixtures)('%s', (name) => {
      const json = JSON.parse(read(`${name}.json`)) as TiptapNode;
      const expected = read(`${name}.md`).replace(/\n$/, '');

      expect(tiptapToMarkdown(json).markdown).toBe(expected);
    });
  });
});
