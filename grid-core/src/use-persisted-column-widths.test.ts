// @vitest-environment jsdom
/**
 * usePersistedColumnWidths — restore-on-mount, persist-on-save, and the
 * corrupt-entry guard (a bad storage slot must never wedge the grid).
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePersistedColumnWidths, type ColumnWidthStorage } from './use-persisted-column-widths';

function memStorage(seed?: Record<string, string>): ColumnWidthStorage & { dump: () => Map<string, string> } {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    dump: () => m,
  };
}

describe('usePersistedColumnWidths', () => {
  it('restores persisted widths on mount', () => {
    const storage = memStorage({ 'colw:test': JSON.stringify({ name: 120, age: 64 }) });
    const { result } = renderHook(() => usePersistedColumnWidths('colw:test', storage));
    expect(result.current[0]).toEqual({ name: 120, age: 64 });
  });

  it('save updates state and writes through to storage', () => {
    const storage = memStorage();
    const { result } = renderHook(() => usePersistedColumnWidths('colw:test', storage));
    expect(result.current[0]).toEqual({});
    act(() => result.current[1]({ name: 200 }));
    expect(result.current[0]).toEqual({ name: 200 });
    expect(JSON.parse(storage.dump().get('colw:test')!)).toEqual({ name: 200 });
  });

  it('discards corrupt or foreign-shaped entries', () => {
    const notJson = memStorage({ 'colw:test': 'not json{' });
    expect(renderHook(() => usePersistedColumnWidths('colw:test', notJson)).result.current[0]).toEqual({});
    const wrongShape = memStorage({
      'colw:test': JSON.stringify({ a: 'wide', b: -3, c: 50, d: null }),
    });
    expect(
      renderHook(() => usePersistedColumnWidths('colw:test', wrongShape)).result.current[0],
    ).toEqual({ c: 50 });
    const arrayEntry = memStorage({ 'colw:test': JSON.stringify([1, 2]) });
    expect(renderHook(() => usePersistedColumnWidths('colw:test', arrayEntry)).result.current[0]).toEqual({});
  });
});
