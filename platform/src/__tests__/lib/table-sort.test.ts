import { sortByText, nextDirection, sortKey } from '@/lib/table-sort';

const sort = (values: string[], dir: 'ascending' | 'descending') => sortByText(values, v => v, dir);

describe('table sort — O3 header sort', () => {
  it('sorts dates as dates, not as text', () => {
    expect(sort(['Oct 1, 2026', 'Aug 2, 2026', 'Oct 28, 2026'], 'ascending')).toEqual(['Aug 2, 2026', 'Oct 1, 2026', 'Oct 28, 2026']);
    expect(sort(['2026-10-28', '2025-01-02', '2026-03-04'], 'descending')).toEqual(['2026-10-28', '2026-03-04', '2025-01-02']);
  });
  it('sorts leading numbers numerically', () => {
    expect(sort(['112 bpm', '69', '8'], 'ascending')).toEqual(['8', '69', '112 bpm']);
    expect(sort(['38.9', '37.1', '40'], 'descending')).toEqual(['40', '38.9', '37.1']);
  });
  it('sorts text naturally', () => {
    expect(sort(['Bed 10', 'bed 2', 'Bed 1'], 'ascending')).toEqual(['Bed 1', 'bed 2', 'Bed 10']);
  });
  it('puts empty cells last in both directions', () => {
    expect(sort(['—', 'Beta', '--', 'Alpha'], 'ascending')).toEqual(['Alpha', 'Beta', '—', '--']);
    expect(sort(['—', 'Beta', 'Alpha'], 'descending')).toEqual(['Beta', 'Alpha', '—']);
  });
  it('does not read a bare number as a date', () => {
    expect(sortKey('12').kind).toBe(1);
    expect(sortKey('Bed 4').kind).toBe(2);
  });
  it('cycles ascending → descending → off', () => {
    expect(nextDirection(null)).toBe('ascending');
    expect(nextDirection('ascending')).toBe('descending');
    expect(nextDirection('descending')).toBeNull();
  });
  it('is stable for equal keys', () => {
    expect(sortByText([{ k: 'a', i: 1 }, { k: 'a', i: 2 }], r => r.k, 'ascending').map(r => r.i)).toEqual([1, 2]);
  });
});
