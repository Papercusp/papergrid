import { describe, expect, it } from 'vitest';
import { createBloomHandler } from './server';
import { createRowStore } from './rowStore';

interface Row { id: string; v: number; name: string }

function makeHandler(universe: Row[]) {
  return createBloomHandler<Row, { q?: string }>({
    loadManifest: async ({ filter, limit, offset }) => {
      const filtered = filter.q
        ? universe.filter(r => r.name.includes(filter.q!))
        : universe;
      return filtered.slice(offset, offset + limit).map(r => ({ id: r.id, v: r.v }));
    },
    loadRows: async (ids) => universe.filter(r => ids.includes(r.id)),
    count: async (filter) =>
      (filter.q ? universe.filter(r => r.name.includes(filter.q!)) : universe).length,
  });
}

describe('createBloomHandler', () => {
  const universe: Row[] = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`,
    v: i + 1,
    name: `row-${i}`,
  }));

  it('returns all rows inline when client sends no bloom', async () => {
    const handle = makeHandler(universe);
    const res = await handle({ filter: {}, limit: 10, offset: 0 });
    expect(res.manifest).toHaveLength(5);
    expect(res.rows).toHaveLength(5);
    expect(res.total).toBe(5);
  });

  it('returns empty rows when client already has every (id, v) in the manifest', async () => {
    const store = createRowStore<Row>();
    store.upsert(universe);
    const handle = makeHandler(universe);
    const res = await handle({
      filter: {},
      limit: 10,
      offset: 0,
      bloom: store.bloomJSON(),
    });
    expect(res.manifest).toHaveLength(5);
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(5);
  });

  it('returns only the stale rows when client has a different version', async () => {
    const store = createRowStore<Row>();
    // Client has r0..r2 at v1 of the OLD universe; we bump their v so they
    // look stale compared to the server's current universe.
    store.upsert(universe.slice(0, 3).map(r => ({ ...r, v: r.v - 100 })));
    const handle = makeHandler(universe);
    const res = await handle({
      filter: {},
      limit: 10,
      offset: 0,
      bloom: store.bloomJSON(),
    });
    expect(res.manifest).toHaveLength(5);
    // Server should return all rows whose (id,v) aren't in the client's bloom.
    // That's every server row because the client's bloom has (id, v-100),
    // not (id, v).
    expect(res.rows.map(r => r.id).sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  it('filters via adapter and respects limit/offset', async () => {
    const handle = makeHandler(universe);
    const res = await handle({ filter: { q: 'row-' }, limit: 2, offset: 1 });
    expect(res.manifest.map(m => m.id)).toEqual(['r1', 'r2']);
    expect(res.rows.map(r => r.id).sort()).toEqual(['r1', 'r2']);
    expect(res.total).toBe(5);
  });
});
