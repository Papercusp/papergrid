// Real IndexedDB integration tests for createIdbPersistence, backed by
// fake-indexeddb. `fake-indexeddb/auto` installs a global `indexedDB`, so the
// adapter exercises its real open/upgrade/read/write/evict paths instead of
// the SSR no-op fallback (covered separately in rowStore.persistence.spec.ts).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { createIdbPersistence } from './idbPersistence';
import { createRowStore } from './rowStore';

interface Row {
  id: string;
  v: number;
  name: string;
}

// Fresh IndexedDB per test so databases don't leak across cases.
beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

const flush = (ms = 25) => new Promise<void>((r) => setTimeout(r, ms));

// Seed a record directly (bypassing the adapter's `save`, which always stamps
// ts = now) so we can plant an artificially old record for eviction tests.
async function rawPut(
  dbName: string,
  storeName: string,
  rec: { id: string; v: number; ts: number; row: Row },
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(storeName)) d.createObjectStore(storeName, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('createIdbPersistence (real IndexedDB)', () => {
  it('persists rows and rehydrates them in a fresh adapter (simulated reload)', async () => {
    const writer = createIdbPersistence<Row>({ dbName: 'roundtrip', writeDebounceMs: 1 });
    writer.save([
      { id: 'a', v: 1, name: 'Alpha' },
      { id: 'b', v: 2, name: 'Beta' },
    ]);
    await flush();

    // Brand-new adapter over the same DB == a page reload.
    const reader = createIdbPersistence<Row>({ dbName: 'roundtrip', writeDebounceMs: 1 });
    const loaded = (await reader.load()).sort((x, y) => x.id.localeCompare(y.id));
    expect(loaded).toEqual([
      { id: 'a', v: 1, name: 'Alpha' },
      { id: 'b', v: 2, name: 'Beta' },
    ]);
  });

  it('a rowStore rehydrates persisted rows from IndexedDB after a reload', async () => {
    const s1 = createRowStore<Row>({
      persistence: createIdbPersistence<Row>({ dbName: 'store', writeDebounceMs: 1 }),
    });
    await s1.ready;
    s1.upsert([{ id: 'a', v: 1, name: 'Alpha' }]);
    await flush();

    const s2 = createRowStore<Row>({
      persistence: createIdbPersistence<Row>({ dbName: 'store', writeDebounceMs: 1 }),
    });
    await s2.ready;
    expect(s2.get('a')?.name).toBe('Alpha');
    // Bloom rehydrated too → the server would skip this row on the next query.
    expect(s2.findMissing([{ id: 'a', v: 1 }])).toEqual([]);
    // …but a newer server version is still detected and refetched.
    expect(s2.findMissing([{ id: 'a', v: 2 }])).toEqual([{ id: 'a', v: 2 }]);
  });

  it('batches rapid saves into the persisted set', async () => {
    const a = createIdbPersistence<Row>({ dbName: 'batch', writeDebounceMs: 5 });
    a.save([{ id: 'a', v: 1, name: 'A' }]);
    a.save([{ id: 'b', v: 1, name: 'B' }]);
    a.save([{ id: 'a', v: 2, name: 'A2' }]); // newer version of a wins
    await flush();
    const loaded = (await a.load()).sort((x, y) => x.id.localeCompare(y.id));
    expect(loaded).toEqual([
      { id: 'a', v: 2, name: 'A2' },
      { id: 'b', v: 1, name: 'B' },
    ]);
  });

  it('wipes persisted rows when schemaVersion is bumped', async () => {
    const v1 = createIdbPersistence<Row>({ dbName: 'schema', schemaVersion: 1, writeDebounceMs: 1 });
    v1.save([{ id: 'a', v: 1, name: 'Alpha' }]);
    await flush();
    expect((await v1.load()).map((r) => r.id)).toEqual(['a']);

    // A higher schemaVersion opens at a higher IDB version → onupgradeneeded
    // recreates the store, discarding rows written under the old envelope.
    const v2 = createIdbPersistence<Row>({ dbName: 'schema', schemaVersion: 2, writeDebounceMs: 1 });
    expect(await v2.load()).toEqual([]);
  });

  it('evicts records older than maxAge on load (and the eviction persists)', async () => {
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    await rawPut('evict', 'rows', {
      id: 'old',
      v: 1,
      ts: Date.now() - eightDaysMs,
      row: { id: 'old', v: 1, name: 'Old' },
    });
    await rawPut('evict', 'rows', {
      id: 'fresh',
      v: 1,
      ts: Date.now(),
      row: { id: 'fresh', v: 1, name: 'Fresh' },
    });

    const a = createIdbPersistence<Row>({ dbName: 'evict' }); // default maxAge 7d
    expect((await a.load()).map((r) => r.id)).toEqual(['fresh']);
    // Re-loading confirms the stale record was actually deleted, not just filtered.
    expect((await a.load()).map((r) => r.id)).toEqual(['fresh']);
  });

  it('clear() removes all persisted rows', async () => {
    const a = createIdbPersistence<Row>({ dbName: 'clearme', writeDebounceMs: 1 });
    a.save([{ id: 'a', v: 1, name: 'A' }]);
    await flush();
    await a.clear();
    expect(await a.load()).toEqual([]);
  });
});
