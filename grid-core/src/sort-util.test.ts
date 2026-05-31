import { describe, it, expect } from 'vitest';
import { applySort } from './sort-util';

/**
 * sort-util.test.ts — P-011 of test-coverage-rest-non-critical. applySort is the
 * client-side RichGrid sort: numeric-vs-locale comparison, null/undefined always
 * to the end regardless of direction, and non-mutating.
 */

// Build a SortState without importing RichGrid (keeps this a pure unit).
type Sort = NonNullable<Parameters<typeof applySort>[1]>;
const sortBy = <T,>(rows: T[], column: string, dir: 'asc' | 'desc'): T[] =>
  applySort(rows, { column, dir } as unknown as Sort);

describe('applySort', () => {
  it('returns the same rows (by reference) when there is no sort state', () => {
    const rows = [{ n: 3 }, { n: 1 }];
    expect(applySort(rows, null)).toBe(rows);
    expect(applySort(rows, undefined)).toBe(rows);
  });

  it('sorts numeric columns numerically (asc + desc) without mutating the input', () => {
    const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect(sortBy(rows, 'n', 'asc').map((r) => r.n)).toEqual([1, 2, 3]);
    expect(sortBy(rows, 'n', 'desc').map((r) => r.n)).toEqual([3, 2, 1]);
    expect(rows.map((r) => r.n)).toEqual([3, 1, 2]); // original untouched
  });

  it('sorts non-numeric values by localeCompare', () => {
    const rows = [{ s: 'banana' }, { s: 'apple' }, { s: 'cherry' }];
    expect(sortBy(rows, 's', 'asc').map((r) => r.s)).toEqual(['apple', 'banana', 'cherry']);
    expect(sortBy(rows, 's', 'desc').map((r) => r.s)).toEqual(['cherry', 'banana', 'apple']);
  });

  it('always sorts null/undefined to the end, regardless of direction', () => {
    const rows = [{ n: 2 }, { n: null }, { n: 1 }, { n: undefined }];
    const asc = sortBy(rows, 'n', 'asc').map((r) => r.n);
    expect(asc.slice(0, 2)).toEqual([1, 2]); // real values sorted ascending
    expect(asc.slice(2).every((v) => v == null)).toBe(true); // blanks trail

    const desc = sortBy(rows, 'n', 'desc').map((r) => r.n);
    expect(desc.slice(0, 2)).toEqual([2, 1]); // real values sorted descending
    expect(desc.slice(2).every((v) => v == null)).toBe(true); // blanks STILL trail
  });
});
