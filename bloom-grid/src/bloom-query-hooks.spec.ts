// @vitest-environment jsdom
/**
 * useBloomQuery / useInfiniteBloomQuery — the client React hooks that were
 * the last untested piece of @papercusp/bloom-grid (EI-423 D-003 next-wave:
 * papergrid coverage). Exercises the real createRowStore (not a mock) so the
 * bloom-false-positive fill path (rowsFetcher → store.upsert → re-render) and
 * cross-page dedup are proven end to end, not just type-checked.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRowStore } from './rowStore';
import { useBloomQuery } from './useBloomQuery';
import { useInfiniteBloomQuery } from './useInfiniteBloomQuery';
import type { BloomQueryResponse } from './protocol';

interface R {
  id: string;
  v: number;
  name: string;
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBloomQuery', () => {
  it('surfaces fetched rows via the store, keyed off the returned manifest', async () => {
    const store = createRowStore<R>();
    const fetcher = vi.fn(
      async (): Promise<BloomQueryResponse<R>> => ({
        manifest: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }],
        rows: [{ id: 'a', v: 1, name: 'A' }, { id: 'b', v: 1, name: 'B' }],
        total: 2,
      }),
    );

    const { result } = renderHook(
      () =>
        useBloomQuery({
          queryKey: ['rows'],
          fetcher,
          filter: {},
          pageSize: 20,
          offset: 0,
          store,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.current.total).toBe(2);
    expect(result.current.error).toBeNull();
    // The bloom sent on the request is derived from the (empty, first-call) store.
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0, bloom: undefined }),
    );
  });

  it('fills bloom false-positive holes via rowsFetcher and re-renders with the completed row', async () => {
    const store = createRowStore<R>();
    // The manifest names 'c', but the primary response's `rows` omits it —
    // simulating a bloom false positive the server couldn't resolve inline.
    const fetcher = vi.fn(
      async (): Promise<BloomQueryResponse<R>> => ({
        manifest: [{ id: 'a', v: 1 }, { id: 'c', v: 1 }],
        rows: [{ id: 'a', v: 1, name: 'A' }],
        total: 2,
      }),
    );
    const rowsFetcher = vi.fn(async (ids: string[]): Promise<R[]> =>
      ids.map((id) => ({ id, v: 1, name: `filled-${id}` })),
    );

    const { result } = renderHook(
      () =>
        useBloomQuery({
          queryKey: ['rows-holes'],
          fetcher,
          rowsFetcher,
          filter: {},
          pageSize: 20,
          offset: 0,
          store,
        }),
      { wrapper: makeWrapper() },
    );

    // The hook only returns rows it can find in the store — 'c' starts absent
    // and appears once the follow-up rowsFetcher lands and upserts it (the
    // useSyncExternalStore subscription then drives a re-render). The mocked
    // rowsFetcher resolves near-instantly, so we assert the converged state
    // rather than pin the transient gap (which races the microtask queue).
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['a', 'c']));
    expect(rowsFetcher).toHaveBeenCalledWith(['c']);
    expect(store.get('c')?.name).toBe('filled-c');
  });

  it('never calls rowsFetcher when the manifest has no gaps', async () => {
    const store = createRowStore<R>();
    const fetcher = vi.fn(
      async (): Promise<BloomQueryResponse<R>> => ({
        manifest: [{ id: 'a', v: 1 }],
        rows: [{ id: 'a', v: 1, name: 'A' }],
        total: 1,
      }),
    );
    const rowsFetcher = vi.fn(async (ids: string[]): Promise<R[]> => ids.map((id) => ({ id, v: 1, name: id })));

    const { result } = renderHook(
      () =>
        useBloomQuery({
          queryKey: ['rows-no-gaps'],
          fetcher,
          rowsFetcher,
          filter: {},
          pageSize: 20,
          offset: 0,
          store,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(rowsFetcher).not.toHaveBeenCalled();
  });
});

describe('useInfiniteBloomQuery', () => {
  it('accumulates rows across pages and reports hasNextPage from the running total', async () => {
    const store = createRowStore<R>();
    const fetcher = vi.fn(async ({ offset, limit }: { offset: number; limit: number }): Promise<BloomQueryResponse<R>> => {
      const allIds = ['a', 'b', 'c'];
      const pageIds = allIds.slice(offset, offset + limit);
      return {
        manifest: pageIds.map((id) => ({ id, v: 1 })),
        rows: pageIds.map((id) => ({ id, v: 1, name: id.toUpperCase() })),
        total: allIds.length,
      };
    });

    const { result } = renderHook(
      () =>
        useInfiniteBloomQuery({
          queryKey: ['infinite'],
          fetcher,
          filter: {},
          pageSize: 2,
          store,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.current.hasNextPage).toBe(true);

    result.current.fetchNextPage();

    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']));
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.total).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate a row that lands on two pages', async () => {
    const store = createRowStore<R>();
    // Deliberately overlapping manifests (e.g. an item shifted between pages
    // under concurrent writes) — the hook's `seen` set must dedup by id.
    const fetcher = vi.fn(async ({ offset }: { offset: number }): Promise<BloomQueryResponse<R>> => {
      if (offset === 0) {
        return {
          manifest: [{ id: 'a', v: 1 }, { id: 'b', v: 1 }],
          rows: [{ id: 'a', v: 1, name: 'A' }, { id: 'b', v: 1, name: 'B' }],
          total: 3,
        };
      }
      return {
        manifest: [{ id: 'b', v: 1 }, { id: 'c', v: 1 }],
        rows: [{ id: 'b', v: 1, name: 'B' }, { id: 'c', v: 1, name: 'C' }],
        total: 3,
      };
    });

    const { result } = renderHook(
      () =>
        useInfiniteBloomQuery({
          queryKey: ['infinite-dupe'],
          fetcher,
          filter: {},
          pageSize: 2,
          store,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['a', 'b']));
    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));

    expect(result.current.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('fetchNextPage is a no-op while already fetching or with no next page', async () => {
    const store = createRowStore<R>();
    const fetcher = vi.fn(
      async (): Promise<BloomQueryResponse<R>> => ({
        manifest: [{ id: 'a', v: 1 }],
        rows: [{ id: 'a', v: 1, name: 'A' }],
        total: 1,
      }),
    );

    const { result } = renderHook(
      () =>
        useInfiniteBloomQuery({
          queryKey: ['infinite-single-page'],
          fetcher,
          filter: {},
          pageSize: 5,
          store,
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasNextPage).toBe(false);

    result.current.fetchNextPage();
    // Give any (incorrect) extra fetch a chance to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
