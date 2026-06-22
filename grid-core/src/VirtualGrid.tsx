import { useEffect, useRef, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import RichGrid, { type RichGridProps } from './RichGrid';

/**
 * VirtualGrid — the drop-in answer to "I have an in-memory row array and I don't
 * want every row mounted as DOM."
 *
 * RichGrid supports virtualization via its `virtualMode` prop, but the caller has
 * to own the scroll element, build a TanStack virtualizer, wire `rowAt`, and
 * re-`measure()` when the rows change. That boilerplate was being copy-pasted
 * (and, more often, SKIPPED — `<RichGrid rows={...}>` renders every row, so teams
 * "fixed" the resulting jank by capping the fetch). VirtualGrid owns all of it:
 * pass `rows` + `columns` + `getRowId` and only the visible window mounts, so the
 * row count stops driving render cost and a cap is no longer needed.
 *
 * It is a thin wrapper — every other RichGrid prop (selection, resizable columns,
 * sort, expansion, getRowBg, onRowClick, empty, …) passes straight through. For
 * the rare case that needs an external/shared scroll element or paged sync, use
 * RichGrid's `virtualMode` directly (or `@papercusp/sync`'s `useSyncVirtualizer`
 * for windowed/infinite-scroll reads).
 */
export interface VirtualGridProps<TRow>
  extends Omit<RichGridProps<TRow>, 'rows' | 'virtualMode' | 'inline'> {
  /** The full in-memory row set. Only the visible window is mounted. */
  rows: TRow[];
  /**
   * Estimated row height in px (the virtualizer's `estimateSize`). Defaults to
   * `rowMinHeight ?? 30`. For uniform-height rows the estimate IS the height;
   * for variable-height rows set `measureVariableHeight` and this is just the
   * pre-measure guess.
   */
  estimateRowHeight?: number;
  /** Rows rendered beyond the viewport on each side. Default 12. */
  overscan?: number;
  /**
   * Measure every visible row's real height (forwards RichGrid's
   * `virtualMode.measureAll`). Opt in ONLY for genuinely variable-height rows
   * (multi-line cards, wrap-on-tags) — for uniform rows it's pure layout cost.
   */
  measureVariableHeight?: boolean;
  /**
   * className for the scroll container. When provided, the caller owns the
   * container's sizing/overflow; when omitted VirtualGrid supplies a sensible
   * `flex: 1; min-height: 0; overflow: auto` (fills a flex parent + scrolls).
   */
  scrollClassName?: string;
  /** Extra style merged onto the scroll container. */
  scrollStyle?: CSSProperties;
}

const DEFAULT_SCROLL_STYLE: CSSProperties = { flex: 1, minHeight: 0, overflow: 'auto' };

export default function VirtualGrid<TRow>({
  rows,
  estimateRowHeight,
  overscan = 12,
  measureVariableHeight,
  scrollClassName,
  scrollStyle,
  rowMinHeight,
  ...richGridProps
}: VirtualGridProps<TRow>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const estimate = estimateRowHeight ?? rowMinHeight ?? 30;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate,
    overscan,
  });
  // Re-measure when the row set changes (filter/sort/sync update) so offsets and
  // the total scroll size track the new data.
  useEffect(() => {
    virtualizer.measure();
  }, [rows, virtualizer]);

  return (
    <div
      ref={scrollRef}
      className={scrollClassName}
      style={scrollClassName ? scrollStyle : { ...DEFAULT_SCROLL_STYLE, ...scrollStyle }}
    >
      <RichGrid<TRow>
        {...richGridProps}
        rowMinHeight={rowMinHeight}
        inline
        virtualMode={{
          virtualizer,
          totalRows: rows.length,
          rowAt: (i) => rows[i],
          measureAll: measureVariableHeight,
        }}
      />
    </div>
  );
}
