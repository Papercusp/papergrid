// IndexedDB-backed RowStorePersistence adapter.
//
// Durable backing for createRowStore(): mirrors versioned row payloads to
// IndexedDB so they survive a full page reload, and rehydrates them on
// startup. Correctness against stale data is NOT this layer's job — it persists
// rows verbatim, keyed by id, and relies on the bloom protocol's version field
// (`v`) plus the always-fresh server manifest to detect and refetch anything
// that changed while it sat in storage. See RowStorePersistence's contract.
//
// This module is CLIENT-ONLY but import-safe on the server: it touches
// `indexedDB` only inside the returned functions, and when `indexedDB` is
// undefined (SSR / unsupported) the factory returns a no-op adapter, so a
// store configured with it behaves exactly like an in-memory store.

import type { RowStorePersistence } from './rowStore';
import type { Versioned } from './protocol';

export interface IdbPersistenceOptions {
  /** IndexedDB database name. Pick a unique name per logical store. */
  dbName?: string;
  /** Object-store name within the database. */
  storeName?: string;
  /**
   * Record-envelope schema version. Used as the IndexedDB *database version*,
   * so bumping it triggers `onupgradeneeded` and wipes the old store. Bump this
   * when the persisted envelope shape changes (not when row contents change —
   * row content staleness is handled by the bloom `v` field).
   */
  schemaVersion?: number;
  /**
   * Evict records whose last-seen timestamp is older than this (ms). This is a
   * storage-size bound, NOT a correctness mechanism — correctness comes from
   * the version field. Default: 7 days.
   */
  maxAgeMs?: number;
  /** Debounce window for batched writes (ms). Default: 400. */
  writeDebounceMs?: number;
}

interface StoredRecord<TRow> {
  id: string;
  v: number;
  /** Last-seen wall-clock ms — refreshed on every save; drives maxAge eviction. */
  ts: number;
  row: TRow;
}

const NOOP_ADAPTER: RowStorePersistence<never> = {
  load: async () => [],
  save: () => { /* no-op */ },
  clear: () => { /* no-op */ },
};

/**
 * Create an IndexedDB-backed persistence adapter for createRowStore().
 * Returns a no-op adapter (so the store stays purely in-memory) when
 * IndexedDB is unavailable, e.g. during SSR or in private-mode browsers.
 */
export function createIdbPersistence<TRow extends Versioned>(
  opts: IdbPersistenceOptions = {},
): RowStorePersistence<TRow> {
  if (typeof indexedDB === 'undefined') {
    return NOOP_ADAPTER as unknown as RowStorePersistence<TRow>;
  }

  const dbName = opts.dbName ?? 'bloom-grid';
  const storeName = opts.storeName ?? 'rows';
  const schemaVersion = opts.schemaVersion ?? 1;
  const maxAgeMs = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const writeDebounceMs = opts.writeDebounceMs ?? 400;

  let dbPromise: Promise<IDBDatabase> | null = null;
  const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      // schemaVersion IS the IDB version → a bump runs onupgradeneeded, which
      // recreates the store and discards records written under the old shape.
      const req = indexedDB.open(dbName, schemaVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
        db.createObjectStore(storeName, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('indexedDB open blocked'));
    });
    return dbPromise;
  };

  // Batched writes — coalesce rapid upserts into one transaction.
  const pending = new Map<string, StoredRecord<TRow>>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    flushTimer = null;
    if (pending.size === 0) return;
    const batch = [...pending.values()];
    pending.clear();
    try {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      const os = tx.objectStore(storeName);
      for (const rec of batch) os.put(rec);
    } catch {
      /* best-effort — drop this batch rather than throwing into app code */
    }
  };

  return {
    async load() {
      try {
        const db = await openDb();
        const cutoff = nowMs() - maxAgeMs;
        return await new Promise<TRow[]>((resolve) => {
          const tx = db.transaction(storeName, 'readwrite');
          const os = tx.objectStore(storeName);
          const req = os.getAll();
          req.onsuccess = () => {
            const recs = (req.result ?? []) as StoredRecord<TRow>[];
            const fresh: TRow[] = [];
            for (const rec of recs) {
              if (rec.ts >= cutoff) {
                fresh.push(rec.row);
              } else {
                // Storage-size eviction of records untouched past maxAge.
                os.delete(rec.id);
              }
            }
            resolve(fresh);
          };
          req.onerror = () => resolve([]);
        });
      } catch {
        return [];
      }
    },
    save(rows) {
      const ts = nowMs();
      for (const r of rows) {
        pending.set(r.id, { id: r.id, v: r.v, ts, row: r });
      }
      if (flushTimer === null) {
        flushTimer = setTimeout(() => void flush(), writeDebounceMs);
      }
    },
    async clear() {
      pending.clear();
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      try {
        const db = await openDb();
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
      } catch {
        /* best-effort */
      }
    },
  };
}

// Wall-clock helper kept separate so the Date access is easy to spot/mock.
function nowMs(): number {
  return Date.now();
}
