// Real IndexedDB integration tests (backed by fake-indexeddb) for the
// IndexedDbKvPersistence class. `fake-indexeddb/auto` installs a global
// `indexedDB`, exercising the real open/upgrade/read/write/evict paths.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDbKvPersistence, createIndexedDbPersistence } from './index';

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

// Seed a record directly (bypassing save(), which always stamps ts = now) so
// we can plant an artificially old record for the eviction test.
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

describe('IndexedDbKvPersistence (real IndexedDB)', () => {
  it('persists records and rehydrates them in a fresh instance (simulated reload)', async () => {
    const writer = createIndexedDbPersistence<Row>({ dbName: 'roundtrip', writeDebounceMs: 1 });
    writer.save([
      { id: 'a', v: 1, name: 'Alpha' },
      { id: 'b', v: 2, name: 'Beta' },
    ]);
    await flush();

    // Brand-new instance over the same DB == a page reload.
    const reader = createIndexedDbPersistence<Row>({ dbName: 'roundtrip', writeDebounceMs: 1 });
    const loaded = (await reader.load()).sort((x, y) => x.id.localeCompare(y.id));
    expect(loaded).toEqual([
      { id: 'a', v: 1, name: 'Alpha' },
      { id: 'b', v: 2, name: 'Beta' },
    ]);
  });

  it('batches rapid saves; newest version of an id wins', async () => {
    const p = new IndexedDbKvPersistence<Row>({ dbName: 'batch', writeDebounceMs: 5 });
    p.save([{ id: 'a', v: 1, name: 'A' }]);
    p.save([{ id: 'b', v: 1, name: 'B' }]);
    p.save([{ id: 'a', v: 2, name: 'A2' }]);
    await flush();
    const loaded = (await p.load()).sort((x, y) => x.id.localeCompare(y.id));
    expect(loaded).toEqual([
      { id: 'a', v: 2, name: 'A2' },
      { id: 'b', v: 1, name: 'B' },
    ]);
  });

  it('wipes persisted records when schemaVersion is bumped', async () => {
    const v1 = new IndexedDbKvPersistence<Row>({ dbName: 'schema', schemaVersion: 1, writeDebounceMs: 1 });
    v1.save([{ id: 'a', v: 1, name: 'Alpha' }]);
    await flush();
    expect((await v1.load()).map((r) => r.id)).toEqual(['a']);

    const v2 = new IndexedDbKvPersistence<Row>({ dbName: 'schema', schemaVersion: 2, writeDebounceMs: 1 });
    expect(await v2.load()).toEqual([]);
  });

  it('evicts records older than maxAge on load (and the eviction persists)', async () => {
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    await rawPut('evict', 'records', {
      id: 'old', v: 1, ts: Date.now() - eightDaysMs, row: { id: 'old', v: 1, name: 'Old' },
    });
    await rawPut('evict', 'records', {
      id: 'fresh', v: 1, ts: Date.now(), row: { id: 'fresh', v: 1, name: 'Fresh' },
    });

    const p = new IndexedDbKvPersistence<Row>({ dbName: 'evict' }); // default maxAge 7d, store 'records'
    expect((await p.load()).map((r) => r.id)).toEqual(['fresh']);
    expect((await p.load()).map((r) => r.id)).toEqual(['fresh']); // deletion persisted, not just filtered
  });

  it('clear() removes all persisted records', async () => {
    const p = new IndexedDbKvPersistence<Row>({ dbName: 'clearme', writeDebounceMs: 1 });
    p.save([{ id: 'a', v: 1, name: 'A' }]);
    await flush();
    await p.clear();
    expect(await p.load()).toEqual([]);
  });
});

describe('IndexedDbKvPersistence without IndexedDB (SSR / unsupported)', () => {
  it('no-ops every method when indexedDB is undefined', async () => {
    const saved = (globalThis as Record<string, unknown>).indexedDB;
    delete (globalThis as Record<string, unknown>).indexedDB;
    try {
      const p = createIndexedDbPersistence<Row>({ dbName: 'ssr' });
      await expect(p.load()).resolves.toEqual([]);
      expect(() => p.save([{ id: 'a', v: 1, name: 'A' }])).not.toThrow();
      await expect(Promise.resolve(p.clear())).resolves.toBeUndefined();
    } finally {
      (globalThis as Record<string, unknown>).indexedDB = saved;
    }
  });
});
