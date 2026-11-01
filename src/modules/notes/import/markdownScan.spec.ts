import { CODE_MASK, maskCode } from './markdownScan';

/** Masked runs shown as `<code>`, so the expectations stay readable. */
const show = (markdown: string) => maskCode(markdown).replace(/+/g, '<code>');

describe('maskCode', () => {
  it('keeps the length and the line breaks', () => {
    const markdown = 'a `b` c\n```\nx\ny\n```\n\n    indented\nend 😀 `ż`';
    const masked = maskCode(markdown);

    expect(masked).toHaveLength(markdown.length);
    expect(masked.split('\n')).toHaveLength(markdown.split('\n').length);
  });

  it('leaves markdown without code unchanged', () => {
    const markdown = '# Title\n\nSee [[Docker]] and [x](a.md).\n\n- a\n- b';
    expect(maskCode(markdown)).toBe(markdown);
  });

  describe('fenced code blocks', () => {
    it('masks the fences and the content', () => {
      expect(show('a\n```ts\n[[x]]\n```\nb')).toBe('a\n<code>\n<code>\n<code>\nb');
    });

    it('masks ~~~ fences', () => {
      expect(show('~~~\n[[x]]\n~~~\nb')).toBe('<code>\n<code>\n<code>\nb');
    });

    it('does not close a ``` block with ~~~ (and vice versa)', () => {
      expect(show('```\n~~~\n[[x]]\n```\nb')).toBe('<code>\n<code>\n<code>\n<code>\nb');
      expect(show('~~~\n```\n[[x]]\n~~~\nb')).toBe('<code>\n<code>\n<code>\n<code>\nb');
    });

    it('closes only with a fence at least as long as the opening one', () => {
      expect(show('````\n```\n[[x]]\n````\nb')).toBe('<code>\n<code>\n<code>\n<code>\nb');
    });

    it('does not close with a fence followed by text', () => {
      expect(show('```\n``` not a close\n```\nb')).toBe('<code>\n<code>\n<code>\nb');
    });

    it('allows up to three spaces of indentation', () => {
      expect(show('   ```\nx\n   ```\nb')).toBe('<code>\n<code>\n<code>\nb');
    });

    it('masks an unclosed block to the end of the document', () => {
      expect(show('a\n```\n[[x]]\n\n[[y]]')).toBe('a\n<code>\n<code>\n\n<code>');
    });

    it('does not open a ``` fence whose info string contains a backtick', () => {
      expect(show('``` a`b\n[[x]]')).toBe('``` a`b\n[[x]]');
    });
  });

  describe('indented code blocks', () => {
    it('masks an indented block after a blank line', () => {
      expect(show('a\n\n    [[x]]\n\tcode\nb')).toBe('a\n\n<code>\n<code>\nb');
    });

    it('masks an indented block at the start of the document', () => {
      expect(show('    [[x]]\nb')).toBe('<code>\nb');
    });

    it('keeps blank lines inside the block', () => {
      expect(show('a\n\n    x\n\n    y\nb')).toBe('a\n\n<code>\n\n<code>\nb');
    });

    it('does not treat a paragraph continuation as code', () => {
      expect(show('a\n    [[x]]')).toBe('a\n    [[x]]');
    });

    it('does not treat nested list items as code', () => {
      expect(show('- a\n    - [[x]]')).toBe('- a\n    - [[x]]');
      expect(show('1. a\n\n    [[x]]\n\n- b\n\n\t- [[y]]')).toBe(
        '1. a\n\n    [[x]]\n\n- b\n\n\t- [[y]]',
      );
    });

    it('treats an indented block as code again once a paragraph ends the list', () => {
      expect(show('- a\n\nparagraph\n\n    [[x]]')).toBe('- a\n\nparagraph\n\n<code>');
    });
  });

  describe('code spans', () => {
    it('masks a span with its delimiters', () => {
      expect(show('a `[[x]]` b')).toBe('a <code> b');
    });

    it('matches only a closing run of the same length', () => {
      expect(show('a ``x ` [[y]]`` b')).toBe('a <code> b');
    });

    it('leaves an unmatched backtick literal', () => {
      expect(show('a ` [[x]]')).toBe('a ` [[x]]');
      expect(show('a `` [[x]] ` b')).toBe('a `` [[x]] ` b');
    });

    it('does not open a span with an escaped backtick', () => {
      expect(show('a \\` [[x]] ` b')).toBe('a \\` [[x]] ` b');
    });

    it('opens a span after an escaped backslash', () => {
      expect(show('a \\\\`[[x]]` b')).toBe('a \\\\<code> b');
    });

    it('spans line breaks within a paragraph', () => {
      expect(show('a `x\n[[y]]` b')).toBe('a <code>\n<code> b');
    });

    it('does not span a blank line', () => {
      expect(show('a `x\n\n[[y]]` b')).toBe('a `x\n\n[[y]]` b');
    });

    it('masks every code unit of a surrogate pair', () => {
      expect(maskCode('`😀`')).toBe(CODE_MASK.repeat(4));
    });
  });

  it('handles many unmatched backticks quickly', () => {
    const markdown = Array.from({ length: 20_000 }, (_, i) => '`'.repeat((i % 50) + 1)).join(' x ');
    const started = Date.now();

    maskCode(markdown);

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
