// @vitest-environment jsdom
/**
 * VirtualGrid.test.tsx — the RichGrid + owned-virtualizer wrapper. We mock
 * `@tanstack/react-virtual`'s `useVirtualizer` to yield a VirtualItem per row
 * (jsdom's 0-height scroll element would otherwise window down to nothing), then
 * assert VirtualGrid drives the REAL RichGrid through `virtualMode`: every row
 * renders, props forward, and the scroll container is owned/styleable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import VirtualGrid from './VirtualGrid';
import type { ColumnDef } from './RichGrid';

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
  }),
}));

interface Row { id: string; label: string }
const columns: ColumnDef<Row>[] = [
  { key: 'label', header: 'Label', width: 1, render: ({ row }) => row.label },
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
});
