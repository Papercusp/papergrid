// Import from the deep path to avoid pulling in IBLT/XorFilter submodules,
// which use Node's Buffer and fail to load under Astro/Vite in the browser.
// The deep module uses CJS default export; Vite's SSR runner and Node ESM
// disagree on how deeply CJS defaults get wrapped, so we unwrap until we
// hit the actual class (must be a function).
import * as BloomFilterModule from 'bloom-filters/dist/bloom/bloom-filter.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveBloomFilter(mod: any): any {
  for (let i = 0; i < 3; i++) {
    if (typeof mod === 'function' && typeof mod.create === 'function') return mod;
    if (mod && typeof mod === 'object' && 'default' in mod) mod = mod.default;
    else break;
  }
  return mod;
}
const BloomFilter = resolveBloomFilter(BloomFilterModule);
import type { ManifestEntry, Versioned } from './protocol';

export interface RowStoreOptions {
  capacity?: number;
  fpRate?: number;
}

export interface RowStore<TRow extends Versioned> {
  upsert(rows: TRow[]): void;
  get(id: string): TRow | undefined;
  has(id: string, v: number): boolean;
  bloomJSON(): unknown | undefined;
  subscribe(fn: () => void): () => void;
  getVersion(): number;
  size(): number;
  clear(): void;
  findMissing(manifest: ManifestEntry[]): ManifestEntry[];
}

export function createRowStore<TRow extends Versioned>(
  opts: RowStoreOptions = {},
): RowStore<TRow> {
  const capacity = opts.capacity ?? 20_000;
  const fpRate = opts.fpRate ?? 0.01;

  let store = new Map<string, TRow>();
  let bloom = BloomFilter.create(capacity, fpRate);
  const subs = new Set<() => void>();
  let version = 0;

  const notify = () => {
    version += 1;
    subs.forEach((fn) => fn());
  };

  return {
    upsert(rows) {
      if (!rows || rows.length === 0) return;
      for (const r of rows) {
        store.set(r.id, r);
        bloom.add(`${r.id}:${r.v}`);
      }
      notify();
    },
    get(id) {
      return store.get(id);
    },
    has(id, v) {
      const existing = store.get(id);
      return existing !== undefined && existing.v === v;
    },
    bloomJSON() {
      if (store.size === 0) return undefined;
      return bloom.saveAsJSON();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    getVersion() {
      return version;
    },
    size() {
      return store.size;
    },
    clear() {
      store = new Map();
      bloom = BloomFilter.create(capacity, fpRate);
      notify();
    },
    findMissing(manifest) {
      return manifest.filter((m) => {
        const existing = store.get(m.id);
        return existing === undefined || existing.v !== m.v;
      });
    },
  };
}
