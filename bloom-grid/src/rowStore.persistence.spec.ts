import { describe, it, expect } from 'vitest';
import { createRowStore, type RowStorePersistence } from './rowStore';
import { createIdbPersistence } from './idbPersistence';

interface Row {
  id: string;
  v: number;
  name: string;
}

/** In-memory fake adapter so we can exercise the store↔persistence contract
 *  without a real IndexedDB. Records every save so tests can assert mirroring. */
function fakeAdapter(seed: Row[] = []): RowStorePersistence<Row> & {
  saved: Row[][];
  cleared: number;
} {
  let backing = [...seed];
  const saved: Row[][] = [];
  let cleared = 0;
  return {
    saved,
    get cleared() { return cleared; },
    load: async () => backing,
    save: (rows) => { saved.push(rows); backing = [...backing, ...rows]; },
    clear: () => { cleared += 1; backing = []; },
  };
}

describe('createRowStore persistence wiring', () => {
  it('resolves ready immediately when there is no persistence', async () => {
    const store = createRowStore<Row>();
    await expect(store.ready).resolves.toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it('rehydrates persisted rows and only resolves ready after load completes', async () => {
    const adapter = fakeAdapter([{ id: 'a', v: 1, name: 'Alpha' }]);
    const store = createRowStore<Row>({ persistence: adapter });

    await store.ready;
    expect(store.size()).toBe(1);
    expect(store.get('a')?.name).toBe('Alpha');
  });

  it('rehydrated rows populate the bloom so the server can skip them', async () => {
    const adapter = fakeAdapter([{ id: 'a', v: 1, name: 'Alpha' }]);
    const store = createRowStore<Row>({ persistence: adapter });
    await store.ready;

    // findMissing returns only rows whose version differs from what's cached.
    const missing = store.findMissing([
      { id: 'a', v: 1 }, // same version → cached, skip
      { id: 'b', v: 1 }, // unknown → must fetch
    ]);
    expect(missing.map((m) => m.id)).toEqual(['b']);
  });

  it('flags a rehydrated row as stale when the manifest reports a newer version', async () => {
    // This is the core staleness guarantee: a week-old persisted row is only
    // trusted for its exact id:v. A newer server version => refetch.
    const adapter = fakeAdapter([{ id: 'a', v: 1, name: 'old' }]);
    const store = createRowStore<Row>({ persistence: adapter });
    await store.ready;

    const missing = store.findMissing([{ id: 'a', v: 2 }]);
    expect(missing).toEqual([{ id: 'a', v: 2 }]);
    expect(store.has('a', 1)).toBe(true);
    expect(store.has('a', 2)).toBe(false);
  });

  it('mirrors upserts to the adapter', async () => {
    const adapter = fakeAdapter();
    const store = createRowStore<Row>({ persistence: adapter });
    await store.ready;

    store.upsert([{ id: 'x', v: 1, name: 'X' }]);
    expect(adapter.saved).toEqual([[{ id: 'x', v: 1, name: 'X' }]]);
  });

  it('clears the adapter when the store is cleared', async () => {
    const adapter = fakeAdapter([{ id: 'a', v: 1, name: 'Alpha' }]);
    const store = createRowStore<Row>({ persistence: adapter });
    await store.ready;

    store.clear();
    expect(adapter.cleared).toBe(1);
    expect(store.size()).toBe(0);
  });

  it('survives a persistence load that rejects (degrades to empty store)', async () => {
    const adapter: RowStorePersistence<Row> = {
      load: async () => { throw new Error('idb unavailable'); },
      save: () => {},
      clear: () => {},
    };
    const store = createRowStore<Row>({ persistence: adapter });
    await expect(store.ready).resolves.toBeUndefined();
    expect(store.size()).toBe(0);
  });
});

describe('createIdbPersistence without IndexedDB (SSR / unsupported)', () => {
  it('returns a no-op adapter that loads nothing and never throws', async () => {
    expect(typeof indexedDB).toBe('undefined'); // node test env
    const adapter = createIdbPersistence<Row>({ dbName: 'test' });
    await expect(adapter.load()).resolves.toEqual([]);
    expect(() => adapter.save([{ id: 'a', v: 1, name: 'A' }])).not.toThrow();
    expect(() => adapter.clear()).not.toThrow();
  });

  it('a store backed by the no-op adapter still works in-memory', async () => {
    const store = createRowStore<Row>({ persistence: createIdbPersistence<Row>() });
    await store.ready;
    store.upsert([{ id: 'a', v: 1, name: 'A' }]);
    expect(store.get('a')?.name).toBe('A');
  });
});
