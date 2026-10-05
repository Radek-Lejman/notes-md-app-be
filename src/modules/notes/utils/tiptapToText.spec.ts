import { tiptapToText } from './tiptapToText';

describe('tiptapToText', () => {
  it('returns empty string for null / undefined', () => {
    expect(tiptapToText(null)).toBe('');
    expect(tiptapToText(undefined)).toBe('');
  });

  it('returns text of a text node', () => {
    expect(tiptapToText({ type: 'text', text: 'abc' })).toBe('abc');
  });

  it('treats empty text as no text and descends into (missing) children', () => {
    expect(tiptapToText({ type: 'text', text: '' })).toBe('');
  });

  it('returns empty string for a node without content', () => {
    expect(tiptapToText({ type: 'doc' })).toBe('');
  });

  it('appends a newline after block nodes', () => {
    expect(tiptapToText({ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] })).toBe(
      'Hi\n',
    );
  });

  it('turns hard breaks (Shift+Enter) into newlines', () => {
    expect(
      tiptapToText({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Mleko' },
          { type: 'hardBreak' },
          { type: 'text', text: 'Chleb' },
        ],
      }),
    ).toBe('Mleko\nChleb\n');
  });

  it('joins children of non-block nodes without a newline', () => {
    expect(
      tiptapToText({
        type: 'doc',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('ab');
  });

  it('flattens a full document', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
          ],
        },
      ],
    };
    expect(tiptapToText(doc)).toBe('Title\nHello world\none\n\n');
  });
});
