import { describe, expect, it } from 'vitest';
import { createRowStore } from './rowStore';

interface R { id: string; v: number; name: string }

describe('createRowStore', () => {
  it('upserts rows and makes them available via get()', () => {
    const s = createRowStore<R>();
    s.upsert([{ id: 'a', v: 1, name: 'A1' }, { id: 'b', v: 2, name: 'B2' }]);
    expect(s.get('a')).toEqual({ id: 'a', v: 1, name: 'A1' });
    expect(s.get('missing')).toBeUndefined();
    expect(s.size()).toBe(2);
  });

  it('has() accounts for version', () => {
    const s = createRowStore<R>();
    s.upsert([{ id: 'a', v: 1, name: 'A1' }]);
    expect(s.has('a', 1)).toBe(true);
    expect(s.has('a', 2)).toBe(false);   // newer version → we don't have it
    expect(s.has('b', 1)).toBe(false);
  });

  it('bloomJSON is undefined when empty, populated after upsert', () => {
    const s = createRowStore<R>();
    expect(s.bloomJSON()).toBeUndefined();
    s.upsert([{ id: 'a', v: 1, name: 'A1' }]);
    expect(s.bloomJSON()).toBeDefined();
  });

  it('findMissing returns manifest entries not present at current version', () => {
    const s = createRowStore<R>();
    s.upsert([{ id: 'a', v: 1, name: 'A1' }, { id: 'b', v: 2, name: 'B2' }]);
    const missing = s.findMissing([
      { id: 'a', v: 1 },   // have it, same version
      { id: 'b', v: 3 },   // have it, but old version
      { id: 'c', v: 1 },   // never seen
    ]);
    expect(missing.map(m => m.id).sort()).toEqual(['b', 'c']);
  });

  it('subscribe / getVersion notifies listeners on upsert and clear', () => {
    const s = createRowStore<R>();
    let hits = 0;
    const un = s.subscribe(() => { hits += 1 });
    s.upsert([{ id: 'a', v: 1, name: 'A1' }]);
    expect(hits).toBe(1);
    const v1 = s.getVersion();
    s.clear();
    expect(s.getVersion()).toBeGreaterThan(v1);
    expect(hits).toBe(2);
    un();
    s.upsert([{ id: 'b', v: 1, name: 'B' }]);
    expect(hits).toBe(2);   // unsubscribed — no more notifications
  });

  it('clear wipes store and bloom', () => {
    const s = createRowStore<R>();
    s.upsert([{ id: 'a', v: 1, name: 'A1' }]);
    s.clear();
    expect(s.size()).toBe(0);
    expect(s.get('a')).toBeUndefined();
    expect(s.bloomJSON()).toBeUndefined();
  });
});
