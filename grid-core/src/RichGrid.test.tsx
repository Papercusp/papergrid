// @vitest-environment jsdom
/**
 * RichGrid.test.tsx — P-009 of test-coverage-rest-non-critical. A focused render
 * + interaction smoke for the legacy (non-virtual) `rows` mode of the grid that
 * ships in the desktop shell: cells render via the column `render(ctx)`
 * callbacks, a sortable header dispatches onSortChange, and a row click
 * dispatches onRowClick. (Virtual mode + measurement are out of scope here.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RichGrid, { type ColumnDef } from './RichGrid';

interface Row {
  id: string;
  name: string;
  age: number;
}

const rows: Row[] = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
];

const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', width: 1, render: (ctx) => ctx.row.name },
  {
    key: 'age',
    header: 'Age',
    width: 1,
    sortKey: 'age',
    render: (ctx) => String(ctx.row.age),
  },
];

afterEach(cleanup);

describe('RichGrid (legacy rows mode)', () => {
  it('renders headers and a cell per row via the column render callbacks', () => {
    render(<RichGrid columns={columns} rows={rows} getRowId={(r) => r.id} />);
    // Headers appear in both the visible grid + the hidden print mirror.
    expect(screen.getAllByText('Name').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Age').length).toBeGreaterThan(0);
    // Data cells render once (print-mirror cells are empty without toCopyText).
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
  });

  it('a sortable header dispatches onSortChange', () => {
    const onSortChange = vi.fn();
    render(
      <RichGrid
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onSortChange={onSortChange}
      />,
    );
    // The sortable ('age') header is a button; the print-mirror 'Age' is not.
    const ageButton = screen
      .getAllByText('Age')
      .map((el) => el.closest('button'))
      .find(Boolean);
    expect(ageButton).toBeTruthy();
    fireEvent.click(ageButton!);
    expect(onSortChange).toHaveBeenCalledTimes(1);
    expect(onSortChange.mock.calls[0][0]).toMatchObject({ column: 'age' });
  });

  it('a row click dispatches onRowClick with the row + index', () => {
    const onRowClick = vi.fn();
    render(
      <RichGrid
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalled();
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: '1', name: 'Alice' });
  });
});

describe('RichGrid resizable columns (controlled)', () => {
  it('renders controlled widths and reports drags via onColumnWidthsChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <RichGrid
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        resizableColumns
        columnWidths={{ name: 222 }}
        onColumnWidthsChange={onChange}
      />,
    );
    // The controlled width feeds the grid template.
    expect(container.innerHTML).toContain('222px');
    // Drag the FIRST column's handle 200px right. jsdom boxes measure 0 wide,
    // so the committed width is max(MIN_COL_WIDTH, 0 + 200) = 200.
    const handle = container.querySelector('div[style*="col-resize"]') as HTMLElement;
    expect(handle).toBeTruthy();
    fireEvent.pointerDown(handle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 300 });
    fireEvent.pointerUp(window);
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0] as Record<string, number>;
    expect(next).toEqual({ name: 200 });
    // Controlled: internal state must NOT have swallowed the drag — the
    // rendered template still shows the caller's 222px until the caller
    // round-trips a new columnWidths prop.
    expect(container.innerHTML).toContain('222px');
  });

  it('uncontrolled mode keeps drag widths internally (no callback needed)', () => {
    const { container } = render(
      <RichGrid columns={columns} rows={rows} getRowId={(r) => r.id} resizableColumns />,
    );
    const handle = container.querySelector('div[style*="col-resize"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window);
    expect(container.innerHTML).toContain('150px');
  });
});
