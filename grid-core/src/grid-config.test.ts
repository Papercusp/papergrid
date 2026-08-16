/**
 * Tests for the pure grid-config helpers: color/formatter resolution, column
 * normalization, dot-path resolution, title derivation, cell formatting.
 * Run with: npx vitest run libs/generic/papergrid/grid-core/src/grid-config.test.ts
 */
import { describe, expect, it } from 'vitest';
import {
  resolveColor,
  evaluateFormatter,
  normalizeColumns,
  resolvePath,
  pathToTitle,
  formatCellValue,
  type CellStyle,
} from './grid-config';

describe('resolveColor', () => {
  it('returns undefined for falsy input', () => {
    expect(resolveColor(undefined)).toBeUndefined();
    expect(resolveColor('')).toBeUndefined();
  });

  it('maps symbolic names to palette colors', () => {
    expect(resolveColor('good')).toBe('#14532d');
    expect(resolveColor('bad')).toBe('#7f1d1d');
    expect(resolveColor('warn')).toBe('#78350f');
    expect(resolveColor('info')).toBe('#1e3a5f');
    expect(resolveColor('dim')).toBe('#1c1f2a');
  });

  it('passes through literal CSS colors unchanged', () => {
    expect(resolveColor('#ffffff')).toBe('#ffffff');
    expect(resolveColor('rebeccapurple')).toBe('rebeccapurple');
    expect(resolveColor('rgb(1,2,3)')).toBe('rgb(1,2,3)');
  });
});

describe('evaluateFormatter', () => {
  const style: CellStyle = { bg: 'good', bold: true };

  it('returns null for an undefined formatter', () => {
    expect(evaluateFormatter(undefined, 'x', {})).toBeNull();
  });

  it('calls a function formatter with value + row', () => {
    const fn = (value: unknown, row: unknown): CellStyle | null =>
      value === 'flag' ? { fg: (row as { c: string }).c } : null;
    expect(evaluateFormatter(fn, 'flag', { c: 'bad' })).toEqual({ fg: 'bad' });
    expect(evaluateFormatter(fn, 'other', { c: 'bad' })).toBeNull();
  });

  it('matches a map formatter on the exact stringified value', () => {
    expect(evaluateFormatter({ active: style }, 'active', {})).toBe(style);
    expect(evaluateFormatter({ '1': style }, 1, {})).toBe(style);
  });

  it('falls back to the "*" catch-all', () => {
    expect(evaluateFormatter({ '*': style }, 'anything', {})).toBe(style);
  });

  it('returns null when neither the key nor "*" match', () => {
    expect(evaluateFormatter({ active: style }, 'inactive', {})).toBeNull();
  });

  it('stringifies null/undefined values to the empty-string key', () => {
    expect(evaluateFormatter({ '': style }, null, {})).toBe(style);
    expect(evaluateFormatter({ '': style }, undefined, {})).toBe(style);
  });
});

describe('normalizeColumns', () => {
  it('wraps bare string paths into { path }', () => {
    expect(normalizeColumns(['a', 'b.c'])).toEqual([{ path: 'a' }, { path: 'b.c' }]);
  });

  it('passes rich column defs through', () => {
    const cols = [{ path: 'a', title: 'A', width: 80 }];
    expect(normalizeColumns(cols)).toEqual(cols);
  });
});

describe('resolvePath', () => {
  it('resolves nested object paths', () => {
    expect(resolvePath({ a: { b: 1 } }, 'a.b')).toBe(1);
  });

  it('indexes into arrays with numeric segments', () => {
    expect(resolvePath({ files: ['x', 'y'] }, 'files.0')).toBe('x');
    expect(resolvePath({ files: ['x', 'y'] }, 'files.1')).toBe('y');
  });

  it('short-circuits to undefined on a null/missing intermediate', () => {
    expect(resolvePath({ a: null }, 'a.b.c')).toBeUndefined();
    expect(resolvePath({ a: {} }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for an empty path', () => {
    expect(resolvePath({ a: 1 }, '')).toBeUndefined();
  });
});

describe('pathToTitle', () => {
  it('humanizes a camelCase last segment', () => {
    expect(pathToTitle('orderDetails.alternateOrderId')).toBe('Alternate Order Id');
    expect(pathToTitle('option.liveLeadData.listItem.resellerPrice')).toBe('Reseller Price');
    expect(pathToTitle('resellerPrice')).toBe('Reseller Price');
  });

  it('returns "" for an empty path', () => {
    expect(pathToTitle('')).toBe('');
  });

  it('combines a numeric tail with its previous segment', () => {
    expect(pathToTitle('files.0')).toBe('Files #0');
    expect(pathToTitle('a.b.2')).toBe('B #2');
  });
});

describe('formatCellValue', () => {
  it('renders null/undefined as empty string', () => {
    expect(formatCellValue(null)).toBe('');
    expect(formatCellValue(undefined)).toBe('');
  });

  it('JSON-stringifies objects and arrays', () => {
    expect(formatCellValue({ a: 1 })).toBe('{"a":1}');
    expect(formatCellValue([1, 2])).toBe('[1,2]');
  });

  it('coerces primitives via String', () => {
    expect(formatCellValue(42)).toBe('42');
    expect(formatCellValue(true)).toBe('true');
    expect(formatCellValue('hi')).toBe('hi');
  });
});
