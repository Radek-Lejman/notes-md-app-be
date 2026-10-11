import { toVectorLiteral, utcTimestamp } from './rag.repository';

describe('toVectorLiteral', () => {
  it('formats numbers as a pgvector literal', () => {
    expect(toVectorLiteral([0.5, -1, 2e-3])).toBe('[0.5,-1,0.002]');
  });

  it.each([[[]], [[1, NaN]], [[Infinity]]])('rejects invalid vectors %j', (vector) => {
    expect(() => toVectorLiteral(vector)).toThrow('Invalid embedding vector');
  });
});

describe('utcTimestamp', () => {
  it('binds the date as an ISO string converted to UTC in SQL', () => {
    const sql = utcTimestamp(new Date('2026-10-11T12:34:56.789Z'));
    expect(sql.sql).toBe(`(?::timestamptz AT TIME ZONE 'UTC')`);
    expect(sql.values).toEqual(['2026-10-11T12:34:56.789Z']);
  });
});
