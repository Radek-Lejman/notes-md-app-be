import { detectLossy } from './detectLossy';

describe('detectLossy', () => {
  it.each([
    ['a GFM table', '| a | b |\n| --- | :-: |\n| 1 | 2 |', ['table']],
    ['a table without outer pipes', 'a | b\n--- | ---\n1 | 2', ['table']],
    ['a one-column table', '| a |\n| --- |\n| 1 |', ['table']],
    ['an image', '![alt](https://example.com/a.png)', ['image']],
    ['an embedded attachment', '![[diagram.png]]', ['image']],
    ['raw HTML', 'a <div class="x">b</div>', ['html']],
    ['a self-closing tag', 'a<br/>b', ['html']],
    ['an HTML comment', '<!-- hidden -->', ['html']],
    ['a footnote', 'text[^1]\n\n[^1]: note', ['footnote']],
    [
      'several kinds, each once',
      '<b>x</b> ![a](b.png) ![c](d.png) [^n]\n\n| a |\n|---|',
      ['table', 'image', 'html', 'footnote'],
    ],
  ])('reports %s', (_case, markdown, expected) => {
    expect(detectLossy(markdown)).toEqual(expected);
  });

  it.each([
    ['plain markdown', '# Title\n\n- a\n- **b**\n\n> quote\n\n[link](x.md) [[Note]]'],
    ['a thematic break', 'a\n\n---\n\nb'],
    ['a setext heading', 'Title\n-----'],
    ['a list with a dash', '- a\n- b'],
    ['an autolink', '<https://example.com>'],
    ['a comparison', 'a < b and c > d'],
    ['a task list', '- [ ] todo\n- [x] done'],
  ])('ignores %s', (_case, markdown) => {
    expect(detectLossy(markdown)).toEqual([]);
  });

  it('ignores the same elements in code', () => {
    const markdown = '```\n| a |\n|---|\n<div> ![a](b) [^1]\n```\n\n`<b>` and `![x](y)`';
    expect(detectLossy(markdown)).toEqual([]);
  });
});
