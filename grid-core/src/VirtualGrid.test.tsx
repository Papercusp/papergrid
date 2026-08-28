// @vitest-environment jsdom
/**
 * VirtualGrid.test.tsx — the RichGrid + owned-virtualizer wrapper. We mock
 * `@tanstack/react-virtual`'s `useVirtualizer` to yield a VirtualItem per row
 * (jsdom's 0-height scroll element would otherwise window down to nothing), then
 * assert VirtualGrid drives the REAL RichGrid through `virtualMode`: every row
 * renders, props forward, and the scroll container is owned/styleable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import VirtualGrid from './VirtualGrid';
import type { ColumnDef } from './RichGrid';

// `scrollToIndex` is hoisted out of the factory so a test can read what the
// component asked the virtualizer to do. It has to be ONE stable fn across
// renders: the stub rebuilds the virtualizer object every render, so a per-render
// `vi.fn()` would drop the calls made by the render being asserted on.
const scrollToIndex = vi.hoisted(() => vi.fn());

// useVirtualizer stub: read `count` from the options and emit one VirtualItem per
// index so RichGrid's virtualMode path renders every row.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i, key: `row-${i}`, start: i * 30, end: i * 30 + 30, size: 30, lane: 0,
      })),
    getTotalSize: () => opts.count * 30,
    measureElement: vi.fn(),
    measure: vi.fn(),
    scrollToIndex,
  }),
}));

interface Row { id: string; label: string }
const columns: ColumnDef<Row>[] = [
  { key: 'label', header: 'Label', width: 1, toCopyText: (r) => r.label, render: ({ row }) => row.label },
];
const rows: Row[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

afterEach(cleanup);

describe('VirtualGrid', () => {
  it('renders every in-memory row through RichGrid virtualMode', () => {
    render(<VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Gamma')).toBeTruthy();
  });

  it('forwards RichGrid props (onRowClick fires with the right row)', () => {
    const onRowClick = vi.fn();
    render(<VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Beta'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect((onRowClick.mock.calls[0][0] as Row).id).toBe('b');
  });

  it('Ctrl+C copies the FULL row set as TSV + HTML (not just the visible window)', () => {
    const { container } = render(<VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} />);
    const scroller = container.firstElementChild as HTMLElement;
    expect(scroller.getAttribute('tabindex')).toBe('0'); // focusable for the copy handler
    const setData = vi.fn();
    fireEvent.copy(scroller, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', expect.stringContaining('Gamma')); // 3rd row → full set, not a viewport
    expect(setData).toHaveBeenCalledWith('text/html', expect.stringContaining('Alpha'));
  });

  it('disableCopySupport drops the copy handler + tabindex', () => {
    const { container } = render(
      <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} disableCopySupport />,
    );
    const scroller = container.firstElementChild as HTMLElement;
    expect(scroller.getAttribute('tabindex')).toBeNull();
  });

  it('owns a scrolling container by default (overflow auto)', () => {
    const { container } = render(<VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} />);
    const scroller = container.firstElementChild as HTMLElement;
    expect(scroller.style.overflow).toBe('auto');
    expect(scroller.style.flexGrow).toBe('1'); // `flex: 1` → grow 1
    expect(scroller.style.minHeight).toBe('0px');
  });

  it('lets the caller own the container via scrollClassName (no default style)', () => {
    const { container } = render(
      <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollClassName="my-scroller" />,
    );
    const scroller = container.firstElementChild as HTMLElement;
    expect(scroller.className).toBe('my-scroller');
    expect(scroller.style.overflow).toBe('');
  });

  it('renders the empty state when there are no rows', () => {
    render(
      <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={[]} empty={<div>Nothing here</div>} />,
    );
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  // ── scrollToRowKey (WI-523949). Virtualization takes away every OTHER way to
  // bring a row into view: a highlight on an unmounted row is invisible, and the
  // row cannot scroll itself because it has no element. Only the virtualizer can
  // move to an index that is not rendered, so this is the one place the "take me
  // to that row" contract can live.
  describe('scrollToRowKey', () => {
    beforeEach(() => scrollToIndex.mockClear());

    it('scrolls to the row with that id, and does nothing without one', () => {
      // Control first: the same component, same instrument, no target. A test
      // that only asserted the positive would pass against an effect that scrolls
      // on every mount.
      const { unmount } = render(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} />,
      );
      expect(scrollToIndex).not.toHaveBeenCalled();
      unmount();

      render(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey="c" />,
      );
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).toHaveBeenCalledWith(2, { align: 'center' });
    });

    it('scrolls ONCE per target, so the reader can scroll away and stay there', () => {
      const { rerender } = render(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey="b" />,
      );
      expect(scrollToIndex).toHaveBeenCalledTimes(1);

      // A re-render with the SAME target must not yank the viewport back. This is
      // the case a naive implementation gets wrong: the stub hands back a fresh
      // virtualizer object every render, so an effect keyed on it alone re-fires.
      rerender(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey="b" />,
      );
      expect(scrollToIndex).toHaveBeenCalledTimes(1);

      // A NEW target is a new intent and does scroll.
      rerender(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey="a" />,
      );
      expect(scrollToIndex).toHaveBeenCalledTimes(2);
      expect(scrollToIndex).toHaveBeenLastCalledWith(0, { align: 'center' });
    });

    it('waits for a target the rows do not hold yet instead of latching it away', () => {
      // The deep-link case that a "fire once and mark it done" latch breaks: the
      // target is routinely absent on first paint because the read has not landed.
      // Missing must mean NOT YET, never NEVER — and never scrollToIndex(-1),
      // which findIndex hands you and the virtualizer would accept.
      const { rerender } = render(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={[]} scrollToRowKey="c" />,
      );
      expect(scrollToIndex).not.toHaveBeenCalled();

      rerender(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey="c" />,
      );
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).toHaveBeenCalledWith(2, { align: 'center' });
    });

    it('re-scrolls to the same row when it is cleared and re-selected', () => {
      const { rerender } = render(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey="b" />,
      );
      expect(scrollToIndex).toHaveBeenCalledTimes(1);

      // Dismiss, then pick the same row again — a real sequence (click to dismiss
      // a selection, then follow a chip back to it). Holding the latch across the
      // clear would silently make the second landing a no-op.
      rerender(<VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey={null} />);
      rerender(
        <VirtualGrid<Row> columns={columns} getRowId={(r) => r.id} rows={rows} scrollToRowKey="b" />,
      );
      expect(scrollToIndex).toHaveBeenCalledTimes(2);
    });

    it('honours the requested alignment', () => {
      render(
        <VirtualGrid<Row>
          columns={columns}
          getRowId={(r) => r.id}
          rows={rows}
          scrollToRowKey="a"
          scrollToRowAlign="start"
        />,
      );
      expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'start' });
    });
  });
});
