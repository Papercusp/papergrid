import { describe, it, expect } from 'vitest';
import { createNoopPersistence, type KvStorePersistence } from './index';

interface Row { id: string; v: number; name: string }

describe('createNoopPersistence', () => {
  it('loads nothing, swallows saves/clears, and satisfies the contract', async () => {
    const p: KvStorePersistence<Row> = createNoopPersistence<Row>();
    await expect(p.load()).resolves.toEqual([]);
    expect(() => p.save([{ id: 'a', v: 1, name: 'A' }])).not.toThrow();
    expect(() => p.clear()).not.toThrow();
    await expect(p.load()).resolves.toEqual([]);
  });
});
