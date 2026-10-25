import { MAX_IMPORT_TITLE_LENGTH } from '../consts/import.consts';
import { fileTitle, folderTitle, importTitle } from './importTitle';

describe('fileTitle', () => {
  it.each([
    ['Docker.md', 'Docker'],
    ['Notes.markdown', 'Notes'],
    ['plain.TXT', 'plain'],
    ['v1.2 release.md', 'v1.2 release'],
    ['Plan 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md', 'Plan'],
    ['Plan 1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D.md', 'Plan'],
    ['Plan1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md', 'Plan1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'],
    ['  spaced  .md', 'spaced'],
    ['   .md', ''],
  ])('%j -> %j', (name, title) => {
    expect(fileTitle(name)).toBe(title);
  });
});

describe('folderTitle', () => {
  it('strips the Notion id but keeps dots', () => {
    expect(folderTitle('Projects 0123456789abcdef0123456789abcdef')).toBe('Projects');
    expect(folderTitle('v1.2')).toBe('v1.2');
  });
});

describe('importTitle', () => {
  it('uses the candidate as it is', () => {
    expect(importTitle('Docker', 'Untitled')).toEqual({ title: 'Docker', warning: null });
  });

  it('normalizes NFD to NFC and trims', () => {
    expect(importTitle('  Gęś '.normalize('NFD'), 'Untitled')).toEqual({
      title: 'Gęś'.normalize('NFC'),
      warning: null,
    });
  });

  it.each([null, '', '   '])('falls back for %j', (candidate) => {
    expect(importTitle(candidate, 'Projects')).toEqual({
      title: 'Projects',
      warning: 'title-fallback',
    });
  });

  it('pads a title shorter than the minimum length', () => {
    expect(importTitle('A', 'Untitled')).toEqual({
      title: 'A (import)',
      warning: 'title-fallback',
    });
  });

  it('pads a too short fallback', () => {
    expect(importTitle('', 'B')).toEqual({ title: 'B (import)', warning: 'title-fallback' });
  });

  it('truncates a long title with an ellipsis', () => {
    const result = importTitle('x'.repeat(MAX_IMPORT_TITLE_LENGTH + 50), 'Untitled');

    expect(result.warning).toBe('title-truncated');
    expect(result.title).toHaveLength(MAX_IMPORT_TITLE_LENGTH);
    expect(result.title.endsWith('…')).toBe(true);
  });

  it('keeps a title of exactly the maximum length', () => {
    const title = 'x'.repeat(MAX_IMPORT_TITLE_LENGTH);
    expect(importTitle(title, 'Untitled')).toEqual({ title, warning: null });
  });

  it('does not cut a surrogate pair in half', () => {
    const result = importTitle('😀'.repeat(MAX_IMPORT_TITLE_LENGTH), 'Untitled');

    expect(result.title.length).toBeLessThanOrEqual(MAX_IMPORT_TITLE_LENGTH);
    expect(result.title).toBe(`${'😀'.repeat((MAX_IMPORT_TITLE_LENGTH - 2) / 2)}…`);
  });
});
