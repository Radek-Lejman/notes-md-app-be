import { createHash } from 'node:crypto';
import { checkStaleness, findStale, hashVault, pinHashes } from './staleness';
import { EvalCase } from './schema';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const evalCase = (paths: string[], goldHashes: Record<string, string> = {}): EvalCase => ({
  id: 'q1',
  question: 'q',
  type: paths.length ? 'fact' : 'unanswerable',
  gold: paths.map((note) => ({ note, grade: 2 })),
  referenceAnswer: '',
  keyFacts: [],
  mustNotClaim: [],
  tags: [],
  origin: 'seed',
  reviewed: false,
  goldHashes,
  createdAt: '2026-11-08',
});

const hashes = hashVault([
  { path: 'a.md', content: 'A' },
  { path: 'Zdrowie/Wstawać.md'.normalize('NFD'), content: 'W' },
]);

describe('hashVault', () => {
  it('hashes raw content under NFC paths', () => {
    expect(hashes.get('a.md')).toBe(sha('A'));
    expect(hashes.get('Zdrowie/Wstawać.md')).toBe(sha('W'));
  });
});

describe('checkStaleness', () => {
  it('is fresh when every pinned hash matches', () => {
    expect(checkStaleness(evalCase(['a.md'], { 'a.md': sha('A') }), hashes)).toEqual({
      status: 'fresh',
    });
  });

  it('is fresh for a case without gold', () => {
    expect(checkStaleness(evalCase([]), hashes)).toEqual({ status: 'fresh' });
  });

  it('is unpinned when gold has no hashes', () => {
    expect(checkStaleness(evalCase(['a.md']), hashes)).toEqual({ status: 'unpinned' });
  });

  it('is stale when a gold note changed', () => {
    expect(checkStaleness(evalCase(['a.md'], { 'a.md': sha('old') }), hashes)).toEqual({
      status: 'stale',
      missing: [],
      changed: ['a.md'],
    });
  });

  it('is stale when a gold note is gone, whatever the hashes say', () => {
    expect(checkStaleness(evalCase(['a.md', 'gone.md'], { 'a.md': sha('A') }), hashes)).toEqual({
      status: 'stale',
      missing: ['gone.md'],
      changed: [],
    });
  });

  it('matches an NFD gold path and ignores gold notes pinned only partially', () => {
    const nfd = 'Zdrowie/Wstawać.md'.normalize('NFD');
    const partial = evalCase(['a.md', nfd], { [nfd]: sha('W') });

    expect(checkStaleness(partial, hashes)).toEqual({ status: 'fresh' });
  });
});

describe('findStale', () => {
  it('lists only stale cases, with what changed or went missing', () => {
    const cases = [
      { ...evalCase(['a.md'], { 'a.md': sha('A') }), id: 'fresh' },
      { ...evalCase(['a.md'], { 'a.md': sha('old') }), id: 'changed' },
      { ...evalCase(['gone.md']), id: 'missing' },
    ];

    expect(findStale(cases, hashes)).toEqual([
      { caseId: 'changed', missing: [], changed: ['a.md'] },
      { caseId: 'missing', missing: ['gone.md'], changed: [] },
    ]);
  });
});

describe('pinHashes', () => {
  it('pins current hashes of existing gold notes, dropping old and missing ones', () => {
    const pinned = pinHashes(evalCase(['a.md', 'gone.md'], { 'a.md': sha('old') }), hashes);

    expect(pinned.goldHashes).toEqual({ 'a.md': sha('A') });
    expect(checkStaleness({ ...pinned, gold: [pinned.gold[0]] }, hashes).status).toBe('fresh');
  });
});
