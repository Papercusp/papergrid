'use client';
/**
 * RichGrid — generic, DOM-based, column-config-driven datagrid.
 *
 * Sibling to DataGridShell (canvas / glide-data-grid). RichGrid uses CSS
 * Grid + divs so each cell can render arbitrary JSX — color-mixed pills,
 * stepper inputs, hover popovers, badges, anything React. Trade-off: caps
 * out around a few thousand rendered rows at a time. For larger sets, pass
 * `virtualMode` and only the visible window mounts.
 *
 * Designed so domain-specific grids (BulkOrderGrid for wholesale procurement,
 * future harness grids, etc.) can be thin specializations that pass:
 *   - their `columns` (with bespoke `render(ctx)` callbacks; ctx = { row, rowIndex, rowBg, isSelected })
 *   - their `rows` or `virtualMode`
 *   - their selection / sort / load-more behaviour
 *
 * What RichGrid owns:
 *   - CSS-grid layout via `gridTemplateColumns` derived from column widths
 *   - Sticky header rendering with sort affordances
 *   - Row-striping / hover background
 *   - Row selection (controlled or uncontrolled)
 *   - Optional virtualization via `@tanstack/virtual-core`
 *   - Optional infinite scroll (`onLoadMore` + threshold)
 *
 * What RichGrid does NOT own:
 *   - Cell content (you write `render(ctx)` per column; destructure `{ row }`)
 *   - Data shape (rows are `TRow`; the only requirement is `getRowId(row)`)
 *   - Business logic (no money formatters, no stepper math, no quote callbacks)
 *
 * This file is intentionally domain-agnostic. Anything specific to wholesale,
 * harness, or any other product should live in the consumer, not here.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { Virtualizer } from '@tanstack/virtual-core';
import { GRID_COLORS } from './grid-theme';

// ─── Public API types ───────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

export interface SortState {
  /** Matches ColumnDef.sortKey */
  column: string;
  dir: SortDir;
}

export type ColumnAlign = 'left' | 'center' | 'right';

export interface CellRenderContext<TRow> {
  row: TRow;
  rowIndex: number;
  rowBg: string;
  isSelected: boolean;
}

export interface ColumnDef<TRow> {
  /** Stable identifier used for React keys and the active sort. */
  key: string;
  /** Header content. Can be a string or arbitrary JSX (e.g. icon + label). */
  header: ReactNode;
  /** Column width in CSS-grid track units (number → fractional with same total). */
  width: number;
  /** How cells in this column are aligned. Default 'left'. */
  align?: ColumnAlign;
  /**
   * When set, the column header becomes a sortable button. The value is
   * passed back to `onSortChange` — typically the upstream column name the
   * data source should sort by (DB column, ZQL field, etc.).
   */
  sortKey?: string;
  /** Direction applied on first click. Default 'asc'. */
  defaultSortDir?: SortDir;
  /** Render function for cells in this column. Called per visible row. */
  render: (ctx: CellRenderContext<TRow>) => ReactNode;
  /**
   * Extra style merged onto this column's cell wrapper (after the default
   * align/padding/font). Either a static object or a per-row callback.
   * Use for per-column tinting, gradient backgrounds, custom borders, etc.
   */
  cellStyle?: CSSProperties | ((ctx: CellRenderContext<TRow>) => CSSProperties);
  /** Class name added to this column's HEADER cell. Useful for hover effects. */
  headerClassName?: string;
}

export interface VirtualMode<TRow> {
  /** TanStack virtualizer instance. Caller owns sizing + scroll element. */
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
  /** Total row count for the virtualized window. */
  totalRows: number;
  /** Lookup row by index. Return `undefined` for not-yet-loaded indexes. */
  rowAt: (index: number) => TRow | undefined;
}

export interface RichGridProps<TRow> {
  /** Column definitions in display order. */
  columns: ColumnDef<TRow>[];

  /** Stable id extractor — required for React keys + selection set. */
  getRowId: (row: TRow) => string;

  /** Legacy mode: render every row in `rows`. Ignored when `virtualMode` is set. */
  rows?: TRow[];

  /** Opt-in virtualization. */
  virtualMode?: VirtualMode<TRow>;

  /** Show a checkbox column on the left for multi-row selection. */
  selectable?: boolean;
  /** Controlled selection (row IDs). When omitted, selection is uncontrolled. */
  selectedRowIds?: ReadonlySet<string>;
  onSelectedRowIdsChange?: (next: ReadonlySet<string>) => void;

  /** Click handler for a row. Receives the row, index, and the click event. */
  onRowClick?: (row: TRow, index: number, e: React.MouseEvent) => void;

  /**
   * Fires on `mouseenter` / `mouseleave` for each row. On enter, both args
   * are non-null; on leave, both are `null`. Use for hover-driven UI
   * outside the grid (e.g. side panels). For purely visual hover the
   * `getRowBg` callback is usually enough.
   */
  onRowHover?: (row: TRow | null, index: number | null) => void;

  /**
   * Single-row expansion: when set, RichGrid renders `renderExpandedRow(row)`
   * immediately below the row whose id matches `expandedRowKey`. The
   * expanded content is part of the same measured wrapper, so virtualization
   * resizes correctly via `measureElement`. The caller fully owns the state
   * — RichGrid does not toggle on click/hover.
   */
  expandedRowKey?: string | null;
  /**
   * Multi-row expansion: any row whose id is in the set will render the
   * expanded content. Combined with `expandedRowKey` (union), so callers
   * can use either or both depending on UX needs.
   */
  expandedRowKeys?: ReadonlySet<string>;
  renderExpandedRow?: (row: TRow) => ReactNode;

  /**
   * Override the default striping/selected/hovered background for a row.
   * Return a CSS color string to override; return `undefined` to fall back
   * to RichGrid's default (selected → rowHover, alternating bg/rowAlt).
   */
  getRowBg?: (row: TRow, rowIndex: number, isSelected: boolean) => string | undefined;

  /**
   * Returns extra HTML attributes (className, tabIndex, aria-*, focus events,
   * data-*) to spread onto the row root. Use for class-based CSS hooks,
   * keyboard accessibility, focus-driven UI, etc. The default `onClick`,
   * `onMouseEnter`, `onMouseLeave` are merged BEFORE this — return them here
   * to override (rare).
   */
  rowProps?: (ctx: CellRenderContext<TRow>) => HTMLAttributes<HTMLDivElement>;

  /** Extra style merged onto the sticky header row. */
  headerStyle?: CSSProperties;

  /**
   * In virtual mode: render a placeholder for a row whose data hasn't yet
   * loaded (when `rowAt(index)` returns `undefined`). Defaults to a small
   * "loading…" line. Pass a shimmer skeleton to match your theme.
   */
  renderLoadingRow?: (rowIndex: number, gridTemplateColumns: string) => ReactNode;

  /**
   * Captures RichGrid's internal scroll element. Use this when you need to
   * tie an external virtualizer (e.g. `useSyncVirtualizer`) to the same
   * scroll container that RichGrid manages. The ref is populated on mount
   * and cleared on unmount. Ignored in `inline` mode.
   */
  scrollContainerRef?: MutableRefObject<HTMLDivElement | null>;

  /**
   * "Embedded" mode: skip RichGrid's outer flex container AND the internal
   * scroll wrapper. Render only `[topSlot, header, body, footerSlot]` as
   * siblings, suitable for consumers that own their own scroll element
   * (custom backgrounds, sticky overlays, an external virtualizer's
   * `scrollRef`, etc.). The sticky header still works because it pins to
   * the consumer's scroll ancestor. `onLoadMore` is ignored in this mode
   * — the consumer owns scroll-edge detection.
   */
  inline?: boolean;

  /** Current sort state. Pass `null` for "no column sorted". */
  sortState?: SortState | null;
  onSortChange?: (next: SortState | null) => void;

  /** Called when the user scrolls near the bottom (legacy mode only). */
  onLoadMore?: () => void;
  /** Pixels-from-bottom threshold to fire `onLoadMore`. Default 1500. */
  loadMoreThreshold?: number;
  /** When true, renders a "Loading…" affordance at the bottom of the list. */
  isLoadingMore?: boolean;

  /** Optional content rendered above the body (e.g. summary bar). */
  topSlot?: ReactNode;
  /** Optional content rendered below the body (e.g. footer / pagination). */
  footerSlot?: ReactNode;

  /** Empty-state ReactNode shown when rows is empty / virtual total is 0. */
  empty?: ReactNode;

  /** Min row height in px. Default 36. */
  rowMinHeight?: number;
  /** Header height in px. Default 36. */
  headerHeight?: number;

  /** Extra style for the outer container. */
  style?: CSSProperties;
  /** Extra className for the outer container. */
  className?: string;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function justifyFor(align: ColumnAlign | undefined): CSSProperties['justifyContent'] {
  if (align === 'right') return 'flex-end';
  if (align === 'center') return 'center';
  return 'flex-start';
}

function textAlignFor(align: ColumnAlign | undefined): CSSProperties['textAlign'] {
  return align ?? 'left';
}

function rowBgFor(index: number, isSelected: boolean): string {
  if (isSelected) return GRID_COLORS.rowHover;
  return index % 2 === 0 ? GRID_COLORS.bg : GRID_COLORS.rowAlt;
}

function buildGridTemplate(columns: ColumnDef<unknown>[], hasSelectionCol: boolean): string {
  const tracks: string[] = [];
  if (hasSelectionCol) tracks.push('40px');
  for (const c of columns) tracks.push(`${c.width}fr`);
  return tracks.join(' ');
}

// ─── Sort icon ──────────────────────────────────────────────────────────────

function SortIcon({ state }: { state: 'inactive' | 'asc' | 'desc' }) {
  const upColor = state === 'asc' ? GRID_COLORS.text : GRID_COLORS.muted;
  const downColor = state === 'desc' ? GRID_COLORS.text : GRID_COLORS.muted;
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 1,
        marginLeft: 4,
        opacity: state === 'inactive' ? 0.4 : 1,
      }}
      aria-hidden="true"
    >
      <span style={{ width: 0, height: 0, borderLeft: '3px solid transparent', borderRight: '3px solid transparent', borderBottom: `4px solid ${upColor}` }} />
      <span style={{ width: 0, height: 0, borderLeft: '3px solid transparent', borderRight: '3px solid transparent', borderTop: `4px solid ${downColor}` }} />
    </span>
  );
}

// ─── Header cell ────────────────────────────────────────────────────────────

interface HeaderCellProps<TRow> {
  col: ColumnDef<TRow>;
  sortState: SortState | null | undefined;
  onSortChange?: (next: SortState | null) => void;
}

function HeaderCell<TRow>({ col, sortState, onSortChange }: HeaderCellProps<TRow>) {
  const sortable = !!col.sortKey && !!onSortChange;
  const active = sortable && sortState?.column === col.sortKey;
  const iconState: 'inactive' | 'asc' | 'desc' = active ? sortState!.dir : 'inactive';

  const cellStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: justifyFor(col.align),
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 600,
    color: GRID_COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    userSelect: 'none',
  };

  if (!sortable) {
    return <div className={col.headerClassName} style={cellStyle}>{col.header}</div>;
  }

  return (
    <button
      type="button"
      className={col.headerClassName}
      onClick={() => {
        if (!onSortChange) return;
        const defaultDir = col.defaultSortDir ?? 'asc';
        if (!active) {
          onSortChange({ column: col.sortKey!, dir: defaultDir });
        } else if (sortState!.dir === defaultDir) {
          onSortChange({ column: col.sortKey!, dir: defaultDir === 'asc' ? 'desc' : 'asc' });
        } else {
          onSortChange(null);
        }
      }}
      style={{
        ...cellStyle,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: active ? GRID_COLORS.text : GRID_COLORS.muted,
      }}
    >
      {col.header}
      <SortIcon state={iconState} />
    </button>
  );
}

// ─── Body row ───────────────────────────────────────────────────────────────

interface BodyRowProps<TRow> {
  row: TRow;
  rowIndex: number;
  isSelected: boolean;
  rowId: string;
  columns: ColumnDef<TRow>[];
  gridTemplateColumns: string;
  selectable: boolean;
  rowMinHeight: number;
  bg: string;
  onRowClick?: (row: TRow, index: number, e: React.MouseEvent) => void;
  // Take the row + index so the caller's callback can stay
  // identity-stable across renders. BodyRow assembles its own
  // mouse-enter/leave handlers internally — that way, when the
  // parent re-renders, BodyRow's props (especially onRowHover)
  // stay equal and React.memo skips the row.
  onRowHover?: (row: TRow | null, index: number | null) => void;
  onSelectChange?: (rowId: string, next: boolean) => void;
  expanded?: ReactNode;
  extraRowProps?: HTMLAttributes<HTMLDivElement>;
}

// Memoized so visible rows that haven't actually changed don't re-render
// when the parent's hover / selection state ticks. The wholesale page
// flips `hoveredId` on every mouse-move, which without memo cascades into
// re-rendering every row in the visible window. With memo + stable prop
// references in the parent, only the previously-hovered and currently-
// hovered rows re-render — the rest stay identity-stable. Custom
// equality treats the `columns` array as immutable (caller memoizes it)
// and skips deep comparisons.
function BodyRowImpl<TRow>({
  row,
  rowIndex,
  isSelected,
  rowId,
  columns,
  gridTemplateColumns,
  selectable,
  rowMinHeight,
  bg,
  onRowClick,
  onRowHover,
  onSelectChange,
  expanded,
  extraRowProps,
}: BodyRowProps<TRow>) {
  const ctx: CellRenderContext<TRow> = { row, rowIndex, rowBg: bg, isSelected };
  const { style: extraStyle, ...restExtra } = extraRowProps ?? {};
  return (
    <div
      role="row"
      onClick={(e) => onRowClick?.(row, rowIndex, e)}
      onMouseEnter={onRowHover ? () => onRowHover(row, rowIndex) : undefined}
      onMouseLeave={onRowHover ? () => onRowHover(null, null) : undefined}
      {...restExtra}
      style={{
        background: bg,
        borderBottom: `1px solid ${GRID_COLORS.border}`,
        cursor: onRowClick ? 'pointer' : 'default',
        // contain:layout paint — row's layout/paint is contained, so a
        // hover bg-color change on row N doesn't trigger reflow of N±1.
        contain: 'layout paint',
        ...extraStyle,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns,
          background: bg,
          minHeight: rowMinHeight,
        }}
      >
        {selectable && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 6px',
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onSelectChange?.(rowId, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Select row"
            />
          </div>
        )}
        {columns.map((col) => {
          const extra =
            typeof col.cellStyle === 'function'
              ? col.cellStyle(ctx)
              : col.cellStyle;
          return (
            <div
              key={col.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: justifyFor(col.align),
                textAlign: textAlignFor(col.align),
                padding: '0 10px',
                fontSize: 13,
                color: GRID_COLORS.text,
                overflow: 'hidden',
                ...extra,
              }}
            >
              {col.render(ctx)}
            </div>
          );
        })}
      </div>
      {expanded}
    </div>
  );
}
const BodyRow = memo(BodyRowImpl) as typeof BodyRowImpl;

// ─── Main component ─────────────────────────────────────────────────────────

export default function RichGrid<TRow>(props: RichGridProps<TRow>) {
  const {
    columns,
    getRowId,
    rows,
    virtualMode,
    selectable = false,
    selectedRowIds: controlledSelected,
    onSelectedRowIdsChange,
    onRowClick,
    onRowHover,
    expandedRowKey = null,
    expandedRowKeys,
    renderExpandedRow,
    getRowBg,
    rowProps,
    headerStyle,
    renderLoadingRow,
    scrollContainerRef,
    inline = false,
    sortState = null,
    onSortChange,
    onLoadMore,
    loadMoreThreshold = 1500,
    isLoadingMore = false,
    topSlot,
    footerSlot,
    empty,
    rowMinHeight = 36,
    headerHeight = 36,
    style,
    className,
  } = props;

  const resolveRowBg = useCallback(
    (row: TRow, rowIndex: number, isSelected: boolean): string => {
      const custom = getRowBg?.(row, rowIndex, isSelected);
      return custom ?? rowBgFor(rowIndex, isSelected);
    },
    [getRowBg],
  );

  const renderExpandedFor = useCallback(
    (row: TRow, rowId: string): ReactNode => {
      if (!renderExpandedRow) return null;
      const isOpen = expandedRowKey === rowId || expandedRowKeys?.has(rowId);
      if (!isOpen) return null;
      return renderExpandedRow(row);
    },
    [renderExpandedRow, expandedRowKey, expandedRowKeys],
  );

  // Uncontrolled selection fallback.
  const [uncontrolled, setUncontrolled] = useState<ReadonlySet<string>>(() => new Set());
  const selectedRowIds = controlledSelected ?? uncontrolled;
  const setSelectedRowIds = useCallback(
    (next: ReadonlySet<string>) => {
      if (controlledSelected !== undefined) {
        onSelectedRowIdsChange?.(next);
      } else {
        setUncontrolled(next);
        onSelectedRowIdsChange?.(next);
      }
    },
    [controlledSelected, onSelectedRowIdsChange],
  );

  const handleRowSelect = useCallback(
    (rowId: string, checked: boolean) => {
      const next = new Set(selectedRowIds);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      setSelectedRowIds(next);
    },
    [selectedRowIds, setSelectedRowIds],
  );

  const gridTemplateColumns = useMemo(
    () => buildGridTemplate(columns as ColumnDef<unknown>[], selectable),
    [columns, selectable],
  );

  const isVirtual = !!virtualMode;
  const totalRows = isVirtual ? virtualMode!.totalRows : (rows?.length ?? 0);
  const isEmpty = totalRows === 0;

  // Legacy-mode infinite scroll.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreFiredRef = useRef(false);
  useEffect(() => {
    if (isVirtual || !onLoadMore) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < loadMoreThreshold) {
        if (!loadMoreFiredRef.current) {
          loadMoreFiredRef.current = true;
          onLoadMore();
        }
      } else {
        loadMoreFiredRef.current = false;
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [isVirtual, onLoadMore, loadMoreThreshold]);

  // Header
  const header = (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns,
        background: GRID_COLORS.headerBg,
        borderBottom: `1px solid ${GRID_COLORS.border}`,
        position: 'sticky',
        top: 0,
        zIndex: 2,
        minHeight: headerHeight,
        ...headerStyle,
      }}
    >
      {selectable && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="checkbox"
            aria-label="Select all rows"
            checked={
              !isEmpty &&
              !isVirtual &&
              !!rows &&
              selectedRowIds.size === rows.length &&
              rows.every((r) => selectedRowIds.has(getRowId(r)))
            }
            onChange={(e) => {
              if (!rows) return;
              if (e.target.checked) {
                setSelectedRowIds(new Set(rows.map(getRowId)));
              } else {
                setSelectedRowIds(new Set());
              }
            }}
            disabled={isVirtual || !rows}
          />
        </div>
      )}
      {columns.map((col) => (
        <HeaderCell key={col.key} col={col} sortState={sortState} onSortChange={onSortChange} />
      ))}
    </div>
  );

  // Body — legacy or virtualized
  let body: ReactNode;
  if (isEmpty) {
    body = (
      <div style={{ padding: 24, color: GRID_COLORS.muted, textAlign: 'center', fontSize: 13 }}>
        {empty ?? 'No data'}
      </div>
    );
  } else if (isVirtual) {
    const items = virtualMode!.virtualizer.getVirtualItems();
    body = (
      <div style={{ position: 'relative', height: virtualMode!.virtualizer.getTotalSize() }}>
        {items.map((vi) => {
          const row = virtualMode!.rowAt(vi.index);
          if (!row) {
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={(el) => {
                  if (el) virtualMode!.virtualizer.measureElement(el);
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {renderLoadingRow ? (
                  renderLoadingRow(vi.index, gridTemplateColumns)
                ) : (
                  <div
                    style={{
                      minHeight: rowMinHeight,
                      borderBottom: `1px solid ${GRID_COLORS.border}`,
                      background: rowBgFor(vi.index, false),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: GRID_COLORS.muted,
                      fontSize: 12,
                    }}
                  >
                    loading…
                  </div>
                )}
              </div>
            );
          }
          const rowId = getRowId(row);
          // Only the row currently expanded has variable height (its
          // expanded panel can grow). Other rows are fixed at
          // rowMinHeight, so skip measureElement for them — every
          // measurement is a forced layout read in the scroll path.
          const isExpandedRow = expandedRowKey === rowId || (expandedRowKeys?.has(rowId) ?? false);
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={
                isExpandedRow
                  ? (el) => {
                      if (el) virtualMode!.virtualizer.measureElement(el);
                    }
                  : undefined
              }
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <BodyRow
                row={row}
                rowIndex={vi.index}
                isSelected={selectedRowIds.has(rowId)}
                rowId={rowId}
                columns={columns}
                gridTemplateColumns={gridTemplateColumns}
                selectable={selectable}
                rowMinHeight={rowMinHeight}
                bg={resolveRowBg(row, vi.index, selectedRowIds.has(rowId))}
                onRowClick={onRowClick}
                onRowHover={onRowHover}
                onSelectChange={handleRowSelect}
                expanded={renderExpandedFor(row, rowId)}
                extraRowProps={
                  rowProps?.({
                    row,
                    rowIndex: vi.index,
                    rowBg: resolveRowBg(row, vi.index, selectedRowIds.has(rowId)),
                    isSelected: selectedRowIds.has(rowId),
                  })
                }
              />
            </div>
          );
        })}
      </div>
    );
  } else {
    body = (
      <>
        {(rows ?? []).map((row, idx) => {
          const rowId = getRowId(row);
          return (
            <BodyRow
              key={rowId}
              row={row}
              rowIndex={idx}
              isSelected={selectedRowIds.has(rowId)}
              rowId={rowId}
              columns={columns}
              gridTemplateColumns={gridTemplateColumns}
              selectable={selectable}
              rowMinHeight={rowMinHeight}
              bg={resolveRowBg(row, idx, selectedRowIds.has(rowId))}
              onRowClick={onRowClick}
              onRowHover={onRowHover}
              onSelectChange={handleRowSelect}
              expanded={renderExpandedFor(row, rowId)}
              extraRowProps={
                rowProps?.({
                  row,
                  rowIndex: idx,
                  rowBg: resolveRowBg(row, idx, selectedRowIds.has(rowId)),
                  isSelected: selectedRowIds.has(rowId),
                })
              }
            />
          );
        })}
        {isLoadingMore && (
          <div
            style={{
              padding: 12,
              textAlign: 'center',
              color: GRID_COLORS.muted,
              fontSize: 12,
            }}
          >
            loading more…
          </div>
        )}
      </>
    );
  }

  if (inline) {
    return (
      <>
        {topSlot}
        {header}
        {body}
        {footerSlot}
      </>
    );
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: GRID_COLORS.bg,
        color: GRID_COLORS.text,
        fontFamily: GRID_COLORS.font,
        ...style,
      }}
    >
      {topSlot}
      <div
        ref={(el) => {
          scrollRef.current = el;
          if (scrollContainerRef) scrollContainerRef.current = el;
        }}
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
      >
        {header}
        {body}
      </div>
      {footerSlot}
    </div>
  );
}
