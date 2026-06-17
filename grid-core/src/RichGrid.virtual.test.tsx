// @vitest-environment jsdom
/**
 * RichGrid.virtual.test.tsx — P-010 of test-coverage-rest-non-critical.
 * Tests the `virtualMode` prop path: virtual items render, loading placeholders
 * appear for missing rows, empty state works with totalRows=0, and the
 * optional custom loading-row renderer is called.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Virtualizer, VirtualItem } from '@tanstack/virtual-core';
import RichGrid, { type ColumnDef, type VirtualMode } from './RichGrid';

interface Row {
  id: string;
  label: string;
}

const columns: ColumnDef<Row>[] = [
  { key: 'label', header: 'Label', width: 1, render: (ctx) => ctx.row.label },
];

/** Build a minimal VirtualItem stub. */
function makeVI(index: number, start: number): VirtualItem {
  return {
    index,
    key: `row-${index}`,
    start,
    end: start + 36,
    size: 36,
    lane: 0,
  };
}

/** Build a minimal Virtualizer mock. */
function makeVirtualizer(items: VirtualItem[], totalSize = 1000): Virtualizer<HTMLDivElement, HTMLDivElement> {
  return {
    getVirtualItems: () => items,
    getTotalSize: () => totalSize,
    measureElement: vi.fn(),
  } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>;
}

afterEach(cleanup);

describe('RichGrid (virtualMode)', () => {
  it('renders visible rows from the virtualizer', () => {
    const rows: Row[] = [
      { id: 'r0', label: 'Alpha' },
      { id: 'r1', label: 'Beta' },
    ];
    const vis: VirtualItem[] = [makeVI(0, 0), makeVI(1, 36)];
    const vm: VirtualMode<Row> = {
      virtualizer: makeVirtualizer(vis, 720),
      totalRows: rows.length,
      rowAt: (i) => rows[i],
    };
    render(
      <RichGrid columns={columns} getRowId={(r) => r.id} virtualMode={vm} />,
    );
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('renders a loading placeholder when rowAt returns undefined', () => {
    const vis: VirtualItem[] = [makeVI(0, 0)];
    const vm: VirtualMode<Row> = {
      virtualizer: makeVirtualizer(vis),
      totalRows: 50,
      rowAt: () => undefined, // simulate not-yet-loaded row
    };
    render(
      <RichGrid columns={columns} getRowId={(r) => r.id} virtualMode={vm} />,
    );
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  it('calls renderLoadingRow for an unloaded row', () => {
    const vis: VirtualItem[] = [makeVI(3, 108)];
    const vm: VirtualMode<Row> = {
      virtualizer: makeVirtualizer(vis),
      totalRows: 100,
      rowAt: () => undefined,
    };
    const renderLoadingRow = vi.fn((_idx: number) => <span>skeleton</span>);
    render(
      <RichGrid
        columns={columns}
        getRowId={(r) => r.id}
        virtualMode={vm}
        renderLoadingRow={renderLoadingRow}
      />,
    );
    expect(screen.getByText('skeleton')).toBeTruthy();
    expect(renderLoadingRow).toHaveBeenCalledWith(3, expect.any(String));
  });

  it('shows the empty state when totalRows is 0', () => {
    const vm: VirtualMode<Row> = {
      virtualizer: makeVirtualizer([], 0),
      totalRows: 0,
      rowAt: () => undefined,
    };
    render(
      <RichGrid
        columns={columns}
        getRowId={(r) => r.id}
        virtualMode={vm}
        empty={<span>nothing here</span>}
      />,
    );
    expect(screen.getByText('nothing here')).toBeTruthy();
  });

  it('renders the column header in virtual mode', () => {
    const vm: VirtualMode<Row> = {
      virtualizer: makeVirtualizer([], 0),
      totalRows: 0,
      rowAt: () => undefined,
    };
    render(<RichGrid columns={columns} getRowId={(r) => r.id} virtualMode={vm} />);
    expect(screen.getAllByText('Label').length).toBeGreaterThan(0);
  });

  it('renders only the virtualizer window, not all N rows', () => {
    // 1000 rows total, but the virtualizer hands back a 3-row window — RichGrid
    // must mount only those three, never the full dataset (the whole point of
    // virtualMode for the big operator-vite lists).
    const rowAt = (i: number): Row => ({ id: `r${i}`, label: `Row ${i}` });
    const vis: VirtualItem[] = [makeVI(10, 360), makeVI(11, 396), makeVI(12, 432)];
    const vm: VirtualMode<Row> = {
      virtualizer: makeVirtualizer(vis, 36_000),
      totalRows: 1000,
      rowAt,
    };
    render(<RichGrid columns={columns} getRowId={(r) => r.id} virtualMode={vm} />);
    expect(screen.getByText('Row 10')).toBeTruthy();
    expect(screen.getByText('Row 12')).toBeTruthy();
    // A row well outside the window is never mounted.
    expect(screen.queryByText('Row 500')).toBeNull();
    expect(screen.getAllByRole('row').filter((el) => el.textContent?.startsWith('Row')).length).toBe(3);
  });

  it('measures every rendered row when virtualMode.measureAll is set', () => {
    // measureAll opts variable-height rows into per-row measurement: the ref
    // callback fires once per mounted row, so measureElement is called for all
    // three (not just an expanded one).
    const rows: Row[] = [
      { id: 'r0', label: 'Alpha' },
      { id: 'r1', label: 'Beta' },
      { id: 'r2', label: 'Gamma' },
    ];
    const vis: VirtualItem[] = [makeVI(0, 0), makeVI(1, 36), makeVI(2, 72)];
    const measureElement = vi.fn();
    const virtualizer = {
      getVirtualItems: () => vis,
      getTotalSize: () => 720,
      measureElement,
    } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>;
    render(
      <RichGrid
        columns={columns}
        getRowId={(r) => r.id}
        virtualMode={{ virtualizer, totalRows: rows.length, rowAt: (i) => rows[i], measureAll: true }}
      />,
    );
    expect(measureElement).toHaveBeenCalledTimes(3);
  });

  it('does NOT measure plain rows by default (measureAll off)', () => {
    // Without measureAll (and no expanded row), RichGrid trusts estimateSize and
    // attaches no measure ref — measureElement stays untouched on the scroll path.
    const rows: Row[] = [
      { id: 'r0', label: 'Alpha' },
      { id: 'r1', label: 'Beta' },
    ];
    const vis: VirtualItem[] = [makeVI(0, 0), makeVI(1, 36)];
    const measureElement = vi.fn();
    const virtualizer = {
      getVirtualItems: () => vis,
      getTotalSize: () => 720,
      measureElement,
    } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>;
    render(
      <RichGrid
        columns={columns}
        getRowId={(r) => r.id}
        virtualMode={{ virtualizer, totalRows: rows.length, rowAt: (i) => rows[i] }}
      />,
    );
    expect(measureElement).not.toHaveBeenCalled();
  });
});
