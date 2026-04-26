'use client';
/**
 * BulkOrderGrid — procurement bulk-buying interface.
 *
 * Renders a CSS-grid-based table (div semantics, not <table>) so the same
 * component can support both:
 *   - Legacy mode: render all products from the `products` prop
 *   - Virtualized mode: accept a `virtualMode` object carrying a TanStack
 *     Virtual virtualizer + rowAt callback. Only visible rows (+ overscan)
 *     are mounted to the DOM; rows dynamically measure their own height so
 *     the expanded hover panel can grow/shrink smoothly.
 *
 * Visual output is identical across both modes — column widths are encoded
 * as `grid-template-columns` percentages that mirror the old colgroup math.
 *
 *  - Local qty state (productId → qty) survives unmount/remount during virtualization
 *  - Live line-total computation with volume-discount tiers
 *  - Optional row multi-select via checkboxes
 *  - Summary bar: selected rows · total units · subtotal
 *  - Configurable "Create Quote" / "Request Quote" action callback
 *  - Optional In Stock column (read-only)
 *  - Optional Target Price column (editable)
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Virtualizer } from '@tanstack/virtual-core';
import {
  GRID_COLORS,
  EDIT_INPUT_STYLE,
  STEPPER_BTN_STYLE,
  STEPPER_PILL_STYLE,
  STEPPER_GLOBAL_CSS,
} from '@restart/grid-core';

/**
 * Rewrite Amazon image-CDN URLs to a small thumbnail variant so browsers
 * don't decode a 1600×1600 JPEG (~10 MB of bitmap RAM) for a 48×48 CSS box.
 * Amazon's CDN accepts an inline size token in the filename:
 *   X.jpg → X._SL{size}_.jpg   (downsampled to {size} px on the longest edge)
 * Safe for non-Amazon URLs (returns unchanged) and for already-sized URLs
 * (replaces the existing size token).
 */
function sizedImage(url: string | undefined, size = 160): string | undefined {
  if (!url) return undefined;
  if (!/\/\/m\.media-amazon\.com\/images\/I\//.test(url) &&
      !/\/\/(images-na\.ssl-)?images-amazon\.com\/images\/I\//.test(url)) {
    return url;
  }
  return url.replace(
    /(\/images\/I\/[A-Za-z0-9_+-]+?)(?:\._[A-Za-z0-9_]+_)?\.(jpg|jpeg|png|webp)(\?.*)?$/i,
    (_m, base, ext, qs = '') => `${base}._SL${size}_.${ext}${qs}`,
  );
}

export interface VolumeDiscountTier {
  minQty: number;
  discountPct: number; // 0.03 = 3%
}

export interface BulkOrderProduct {
  id: string;
  name: string;
  brand?: string;
  model?: string;
  condition?: string;
  specs?: string;
  priceCents: number;
  imageUrl?: string;
  slug?: string;
  groupId?: string;
  /**
   * Live qty from the warehouse table. Undefined while the row's stock has
   * not yet been loaded — in that case the grid renders a spinner in the
   * qty / price / line-total cells instead of placeholder zeros.
   */
  stockQty?: number;
  /**
   * Explicit "data loaded" flag. Defaults to true. Set to false by the
   * caller when neither the live stock nor the mirror columns have arrived
   * yet — used to render spinners in the qty / price / line-total cells.
   */
  loaded?: boolean;
}

export interface BulkOrderRow extends BulkOrderProduct {
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  lineTotalDisplay: string;
  unitPriceDisplay: string;
  targetPriceCentsEditable: number;
  targetPriceDisplay: string;
  stockQtyDisplay: string;
  gradeDisplay: string;
  conditionDisplay: string;
}

/**
 * Opt-in virtualization. When provided, the scroll container is the one
 * returned by `virtualizer.options.getScrollElement` (which the caller sets
 * up via `useSyncVirtualizer`). Only rows within the virtualizer's window
 * are rendered; they `measureElement` so dynamic expanded-panel heights work.
 */
export interface BulkOrderVirtualMode {
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>;
  rowAt: (index: number) => BulkOrderProduct | undefined;
  /** Ref the caller attaches to the outermost scroll element (getScrollElement). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Shown in the summary "N loaded" label. */
  estimatedTotal?: number;
  /** Exact total once both ends are reached (undefined until then). */
  total?: number;
}

export interface BulkOrderGridProps {
  /** Product list in legacy (non-virtualized) mode. Ignored when `virtualMode` is set. */
  products?: BulkOrderProduct[];
  volumeTiers?: VolumeDiscountTier[];
  onCreateQuote?: (items: Array<{
    productId: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
    targetPriceCents: number;
  }>) => void;
  onSaveAsList?: (items: Array<{ productId: string; qty: number }>) => void;
  loading?: boolean;
  initialQtys?: Record<string, number>;
  initialTargetPrices?: Record<string, number>;
  hideRowSelection?: boolean;
  createQuoteLabel?: string;
  showStockQty?: boolean;
  enableTargetPrice?: boolean;
  /**
   * Summary mode — render a browse-only grid per group (no per-row purchase UI).
   * Drops Grade / Target Qty / Target Price / Line Total columns, widens the
   * Product column, and prefixes the Unit Price cell with "from". Intended
   * for group-level catalogs where the actual purchase happens in an
   * expanded-row variant picker, not on the grid row itself.
   */
  summaryMode?: boolean;
  submitting?: boolean;
  onSecondaryAction?: (items: Array<{
    productId: string; qty: number; unitPriceCents: number;
    lineTotalCents: number; targetPriceCents: number;
  }>) => void;
  secondaryActionLabel?: string;
  secondarySubmitting?: boolean;
  onQuoteItemsChange?: (items: Array<{
    productId: string;
    productName: string;
    productImageUrl?: string;
    condition: string;
    qty: number;
    unitPriceCents: number;
    targetPriceCents: number;
    lineTotalCents: number;
    stockQty?: number;
  }>) => void;
  actionSlot?: ReactNode;
  qtySetterRef?: React.MutableRefObject<((productId: string, qty: number) => void) | null>;
  targetPriceSetterRef?: React.MutableRefObject<((productId: string, priceCents: number) => void) | null>;
  externalSummary?: {
    productCount: number;
    totalUnits: number;
    subtotalCents: number;
    /** When true, summary bar renders spinners instead of numbers (initial cart hydration). */
    loading?: boolean;
  };
  onViewQuote?: () => void;
  renderExpandedRow?: (row: BulkOrderRow) => ReactNode;
  renderImagePopover?: (row: BulkOrderRow) => ReactNode;
  footerSlot?: ReactNode;
  /**
   * Called when the user has scrolled near the bottom of the non-virtualized
   * list. Consumers wire this to a paginated fetcher. Debounced internally so
   * it only fires once per "reach" event — repeated calls while the grid is
   * still rendering the just-fetched page are suppressed.
   * Ignored in virtualMode (the virtualizer owns scroll handling there).
   */
  onLoadMore?: () => void;
  /** How close (px) to the bottom before `onLoadMore` fires. Default 1500. */
  loadMoreThreshold?: number;
  /** When true, renders a "Loading more…" row at the bottom of the list. */
  isLoadingMore?: boolean;
  /** Opt-in virtualization using `useSyncVirtualizer`. */
  virtualMode?: BulkOrderVirtualMode;
  /**
   * Current sort state. When `null`/`undefined` no column header is shown
   * as active — the caller's query is expected to use its own default order
   * (for the wholesale grid that's `createdAt DESC`).
   */
  sortState?: SortState | null;
  /**
   * Invoked when the user clicks a sortable column header.
   *  - First click on an inactive column → `{ column, dir: col.defaultSortDir }`
   *  - Click on the currently active column → toggles `dir`
   * Caller owns the sort state and its persistence.
   */
  onSortChange?: (next: SortState) => void;
}

const DEFAULT_TIERS: VolumeDiscountTier[] = [
  { minQty: 5,  discountPct: 0.03 },
  { minQty: 10, discountPct: 0.05 },
  { minQty: 23, discountPct: 0.06 },
  { minQty: 35, discountPct: 0.08 },
  { minQty: 50, discountPct: 0.10 },
];
const EMPTY_QTYS: Record<string, number> = {};
const EMPTY_PRODUCTS: BulkOrderProduct[] = [];

export function applyVolumeDiscount(priceCents: number, qty: number, tiers: VolumeDiscountTier[]): number {
  if (qty <= 0) return priceCents;
  const sorted = [...tiers].sort((a, b) => b.minQty - a.minQty);
  const tier = sorted.find((t) => qty >= t.minQty);
  if (!tier || tier.discountPct === 0) return priceCents;
  return Math.round(priceCents * (1 - tier.discountPct));
}

import { formatCentsForRegion } from './region';

function centsToDisplay(cents: number): string {
  return formatCentsForRegion(cents);
}

function conditionToGrade(condition: string): string {
  const c = (condition ?? '').toUpperCase().trim();
  if (c === 'REF') return 'A';
  if (c === 'B')   return 'B';
  if (c === 'C')   return 'C';
  return '';
}

function conditionToLabel(condition: string): string {
  const c = (condition ?? '').toUpperCase().trim();
  if (c === 'NEW') return 'New';
  return 'Refurbished';
}

// ─── styles ──────────────────────────────────────────────────────────────────

const COLORS = GRID_COLORS;

const cellBase: React.CSSProperties = {
  padding: '13px 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  fontFamily: COLORS.font,
  fontSize: 13,
  color: COLORS.text,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
  fontVariantNumeric: 'tabular-nums',
  display: 'flex',
  alignItems: 'center',
  // default cell justifies center for visual parity with old `text-align: center`
  justifyContent: 'center',
  boxSizing: 'border-box',
};

const headerCellBase: React.CSSProperties = {
  ...cellBase,
  background: `linear-gradient(180deg, rgba(16,24,39,0.98) 0%, rgba(10,15,26,0.98) 100%)`,
  color: '#b7c2d5',
  fontWeight: 700,
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  userSelect: 'none',
  padding: '11px 12px',
};

const inputStyle: React.CSSProperties = EDIT_INPUT_STYLE;

// ─── column definitions ──────────────────────────────────────────────────────

interface ColDef {
  key: string;
  title: string;
  width: number;
  align?: 'right' | 'left' | 'center';
  /**
   * When set, the column is sortable. This is the identifier passed to
   * `onSortChange` — usually the DB column name the caller's query should
   * sort by. Columns without `sortKey` render a plain, non-clickable header.
   */
  sortKey?: string;
  /** Direction applied on first click. Defaults to 'asc'. */
  defaultSortDir?: 'asc' | 'desc';
}

export interface SortState {
  /** Matches ColDef.sortKey */
  column: string;
  dir: 'asc' | 'desc';
}

const STATIC_COLS: ColDef[] = [
  { key: 'name',             title: 'Product',   width: 220, align: 'left',   sortKey: 'name', defaultSortDir: 'asc' },
  { key: 'gradeDisplay',     title: 'Grade',     width: 92,  align: 'center' },
];

// Maps col.align → CSS justify-content so div cells keep table-text-align feel.
function justifyFor(align: ColDef['align'] | undefined): React.CSSProperties['justifyContent'] {
  if (align === 'left') return 'flex-start';
  if (align === 'right') return 'flex-end';
  return 'center';
}

// Maps col.align → CSS text-align for descendants that care (inputs, spans).
function textAlignFor(align: ColDef['align'] | undefined): React.CSSProperties['textAlign'] {
  if (align === 'left') return 'left';
  if (align === 'right') return 'right';
  return 'center';
}

// ─── row cell renderer ───────────────────────────────────────────────────────

/**
 * Renders the inner cell markup for a single column. Called from both
 * virtualized and legacy row components; the caller wraps it in a styled div.
 */
interface CellContext {
  row: BulkOrderRow;
  rowBg: string;
  stockColor: string;
  warnings: Record<string, string>;
  handleQtyChange: (productId: string, value: string, max?: number) => void;
  handleTargetPriceChange: (productId: string, value: string, currentPriceCents?: number) => void;
  renderImagePopover?: (row: BulkOrderRow) => ReactNode;
  setImagePopover: (state: { id: string; top: number; left: number; imgW: number; imgH: number } | null) => void;
  cancelImgCollapse: () => void;
  scheduleImgCollapse: () => void;
  volumeTiers?: VolumeDiscountTier[];
  summaryMode?: boolean;
}

function cellContent(col: ColDef, ctx: CellContext): ReactNode {
  const { row } = ctx;
  const align = col.align ?? 'center';
  switch (col.key) {
    // ── Qty stepper ────────────────────────────────────────────────────────
    case 'qtyInput': {
      const qtyWarn = ctx.warnings[row.id + ':qty'];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: '100%' }}>
          <div style={STEPPER_PILL_STYLE} className="bog-qty-pill">
            <button
              type="button"
              style={STEPPER_BTN_STYLE}
              className="bog-qty-btn"
              onClick={(e) => {
                e.stopPropagation();
                ctx.handleQtyChange(row.id, String(Math.max(0, row.qty - 1)), row.stockQty);
              }}
              disabled={row.qty === 0}
            >
              &minus;
            </button>
            <input
              type="number"
              min={0}
              step={1}
              value={row.qty === 0 ? '' : row.qty}
              placeholder="0"
              onChange={(e) => ctx.handleQtyChange(row.id, e.target.value, row.stockQty)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 36,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                textAlign: 'center',
                fontFamily: COLORS.font,
                fontSize: 13,
                fontWeight: 500,
                color: row.qty === 0 ? COLORS.muted : COLORS.text,
                fontVariantNumeric: 'tabular-nums',
                MozAppearance: 'textfield',
              } as React.CSSProperties}
              className="bog-qty-input"
            />
            <button
              type="button"
              style={STEPPER_BTN_STYLE}
              className="bog-qty-btn"
              onClick={(e) => {
                e.stopPropagation();
                ctx.handleQtyChange(row.id, String(row.qty + 1), row.stockQty);
              }}
            >
              +
            </button>
          </div>
          {qtyWarn && (
            <div style={{ fontSize: 10, color: COLORS.amber, whiteSpace: 'normal', lineHeight: 1.3, textAlign: 'center' }}>
              {qtyWarn}
            </div>
          )}
          {/* Quick-tier jump chips — always-rendered (no row-height shift), faded in on row hover */}
          {(() => {
            const tiers = ctx.volumeTiers ?? [];
            // Pick chip values from tier thresholds ≥ 5 (first meaningful tier), capped at stockQty if known.
            const candidates = tiers
              .map((t) => t.minQty)
              .filter((q) => q >= 5)
              .filter((q, i, arr) => arr.indexOf(q) === i)
              .sort((a, b) => a - b);
            const chips = candidates.filter((q) => typeof row.stockQty !== 'number' || q <= row.stockQty);
            const showMax = typeof row.stockQty === 'number' && row.stockQty > 0 && !chips.includes(row.stockQty);
            if (chips.length === 0 && !showMax) return null;
            const labelFor = (q: number) => (q >= 1000 ? `${(q / 1000).toFixed(q % 1000 === 0 ? 0 : 1)}K` : String(q));
            return (
              <div
                className="bog-qty-chips"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  marginTop: 3,
                  height: 22,
                  opacity: 0,
                  transition: 'opacity 0.18s ease',
                  pointerEvents: 'none',
                }}
              >
                {chips.map((q) => {
                  const isActive = row.qty >= q;
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); ctx.handleQtyChange(row.id, String(q), row.stockQty); }}
                      title={`Jump to ${q} units`}
                      style={{
                        appearance: 'none',
                        background: isActive ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.03)',
                        color: isActive ? COLORS.green : COLORS.muted,
                        border: `1px solid ${isActive ? 'rgba(52,211,153,0.50)' : 'rgba(255,255,255,0.10)'}`,
                        borderRadius: 999,
                        padding: '3px 10px',
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        lineHeight: 1,
                        cursor: 'pointer',
                        fontFamily: COLORS.font,
                        fontVariantNumeric: 'tabular-nums',
                        transition: 'background 120ms, border-color 120ms, color 120ms, transform 120ms',
                      }}
                    >
                      {labelFor(q)}
                    </button>
                  );
                })}
                {showMax && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); ctx.handleQtyChange(row.id, String(row.stockQty!), row.stockQty); }}
                    title={`Fill with all ${row.stockQty} in stock`}
                    style={{
                      appearance: 'none',
                      background: row.qty === row.stockQty ? 'rgba(52,211,153,0.18)' : 'transparent',
                      color: row.qty === row.stockQty ? COLORS.green : COLORS.muted,
                      border: `1px dashed ${row.qty === row.stockQty ? 'rgba(52,211,153,0.50)' : 'rgba(255,255,255,0.18)'}`,
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: 9.5,
                      fontWeight: 700,
                      letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      lineHeight: 1,
                      cursor: 'pointer',
                      fontFamily: COLORS.font,
                      transition: 'background 120ms, border-color 120ms, color 120ms',
                    }}
                  >
                    Max
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      );
    }

    // ── Product name + thumbnail + shimmer ─────────────────────────────────
    case 'name': {
      return (
        <a
          href={row.groupId ? `/p/${row.groupId}` : undefined}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            minWidth: 0,
            width: '100%',
            textDecoration: 'none',
            color: 'inherit',
            cursor: row.groupId ? 'pointer' : 'default',
          }}
        >
          <span
            style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
            onMouseEnter={(e) => {
              if (!ctx.renderImagePopover || !row.groupId) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              ctx.cancelImgCollapse();
              ctx.setImagePopover({
                id: row.id,
                top: rect.top,
                left: rect.right + 8,
                imgW: rect.width,
                imgH: rect.height,
              });
            }}
            onMouseLeave={() => {
              if (ctx.renderImagePopover) ctx.scheduleImgCollapse();
            }}
          >
            {row.imageUrl ? (
              <img
                src={sizedImage(row.imageUrl, 160)}
                alt=""
                className="bog-thumb"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 10,
                  objectFit: 'contain',
                  background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.08), transparent 56%), linear-gradient(180deg, #202838 0%, #151b28 100%)',
                  flexShrink: 0,
                  border: `1px solid rgba(255,255,255,0.13)`,
                  boxShadow: '0 10px 22px -18px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.05)',
                  cursor: ctx.renderImagePopover && row.groupId ? 'zoom-in' : 'inherit',
                  transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
                }}
              />
            ) : !row.name ? (
              <div
                className="bog-shimmer"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  flexShrink: 0,
                  border: `1px solid ${COLORS.border}`,
                }}
              />
            ) : (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #1c2230 0%, #171b26 100%)',
                  flexShrink: 0,
                  border: `1px solid ${COLORS.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: COLORS.muted,
                }}
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
              </div>
            )}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
            <span style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              wordBreak: 'break-word',
              whiteSpace: 'normal',
              fontWeight: 600,
              fontSize: 13.25,
              color: COLORS.text,
              lineHeight: 1.3,
              maxHeight: 'calc(13.25px * 1.3 * 2)',
            }}>
              {row.name || (!row.imageUrl ? (
                <span
                  aria-hidden="true"
                  className="bog-shimmer"
                  style={{
                    display: 'inline-block',
                    width: '70%',
                    height: 12,
                    borderRadius: 4,
                    verticalAlign: 'middle',
                  }}
                />
              ) : null)}
            </span>
            {(() => {
              const category = (row as unknown as { category?: string }).category;
              if (!category) return null;
              return (
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 10,
                  color: '#9aa8bd',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}>
                  {String(category).replace(/[_-]+/g, ' ')}
                </span>
              );
            })()}
          </span>
          {row.groupId && (
            <span className="bog-row-link" style={{
              opacity: 0,
              color: COLORS.blue,
              transition: 'opacity 0.15s',
              flexShrink: 0,
              marginLeft: 4,
            }} aria-hidden="true">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M7 17l10-10M17 7H9M17 7v8"/></svg>
            </span>
          )}
        </a>
      );
    }

    // ── Target price input ─────────────────────────────────────────────────
    case 'targetPriceInput': {
      const displayVal = row.targetPriceDisplay;
      const priceWarn = ctx.warnings[row.id + ':price'];
      return (
        <div style={{ width: '100%' }}>
          <input
            type="text"
            inputMode="decimal"
            defaultValue={displayVal}
            key={`tp-${row.id}-${row.targetPriceCentsEditable}`}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => ctx.handleTargetPriceChange(row.id, e.target.value, row.unitPriceCents)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                ctx.handleTargetPriceChange(row.id, (e.target as HTMLInputElement).value, row.unitPriceCents);
                (e.target as HTMLInputElement).blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            style={inputStyle}
          />
          {priceWarn && (
            <div style={{ fontSize: 10, color: COLORS.amber, marginTop: 3, whiteSpace: 'normal', lineHeight: 1.3, opacity: 0.9 }}>
              {priceWarn}
            </div>
          )}
        </div>
      );
    }

    // ── Condition badge (New / Refurbished) ──────────────────────
    // Condition cell retained as fallback only — the Condition column is no longer in STATIC_COLS (merged into Grade).
    case 'conditionDisplay': return null;

    // ── Grade badge (A / B / C) ─────────────────────────────
    // ── Grade cell: merged Condition + Grade. Shows "NEW" pill for new items, A/B/C badge for refurbs. ─────
    case 'gradeDisplay': {
      const isNew = row.conditionDisplay === 'New';
      if (isNew) {
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 10px 3px 8px',
              borderRadius: 20,
              background: 'linear-gradient(180deg, rgba(52,211,153,0.18) 0%, rgba(52,211,153,0.08) 100%)',
              border: '1px solid rgba(52,211,153,0.42)',
              color: COLORS.green,
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
            title="Brand-new unit, unused"
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.green, boxShadow: `0 0 6px ${COLORS.green}`, flexShrink: 0 }} />
            New
          </span>
        );
      }
      const g = row.gradeDisplay;
      if (g === '') return <span style={{ color: COLORS.muted, fontSize: 11 }}>—</span>;
      const meta =
        g === 'A' ? { color: COLORS.amber, bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.42)',  label: 'Refurb A — like-new cosmetics, tested & graded' } :
        g === 'B' ? { color: COLORS.blue,  bg: 'rgba(122,162,247,0.12)', border: 'rgba(122,162,247,0.40)', label: 'Refurb B — light wear, fully functional' } :
        g === 'C' ? { color: COLORS.red,   bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.42)', label: 'Refurb C — visible wear, priced accordingly' } :
                    { color: COLORS.muted, bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)', label: `Grade ${g}` };
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 9px 3px 6px',
            borderRadius: 20,
            background: meta.bg,
            border: `1px solid ${meta.border}`,
            color: meta.color,
            fontWeight: 600,
            fontSize: 10.5,
            letterSpacing: '0.04em',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
          title={meta.label}
        >
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(0,0,0,0.35)',
            border: `1.5px solid ${meta.border}`,
            color: meta.color,
            fontWeight: 800, fontSize: 10.5, lineHeight: 1,
            boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.04)`,
          }}>{g}</span>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 9, fontWeight: 700 }}>Refurb</span>
        </span>
      );
    }

    // ── Stock qty ─ richer chip with availability tone ────────────
    case 'stockQtyDisplay': {
      if (row.loaded === false) {
        return <span className="bog-spinner" aria-label="Loading qty" />;
      }
      const q = row.stockQty;
      // Tone-coded bucket: 0 = red/out, ≤3 = amber/low, ≤20 = blue/moderate, >20 = emerald/strong
      const meta =
        typeof q !== 'number'     ? { color: COLORS.muted, bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)' } :
        q === 0                   ? { color: COLORS.red,   bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.30)' } :
        q <= 3                    ? { color: COLORS.amber, bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.28)' } :
        q <= 20                   ? { color: COLORS.blue,  bg: 'rgba(122,162,247,0.06)', border: 'rgba(122,162,247,0.20)' } :
                                    { color: COLORS.green, bg: 'rgba(52,211,153,0.07)',  border: 'rgba(52,211,153,0.22)' };
      return (
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 999,
            background: `linear-gradient(90deg, ${meta.bg}, rgba(255,255,255,0.018))`,
            border: `1px solid ${meta.border}`,
            color: meta.color,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            fontSize: 12.5,
            minWidth: 60,
            overflow: 'hidden',
          }}
          title={typeof q === 'number' ? `${q.toLocaleString()} units in stock—${q === 0 ? 'out of stock' : q <= 3 ? 'low stock, order soon' : q <= 20 ? 'moderate stock' : 'plenty available'}` : 'Stock loading'}
        >
          {/* Stock-level fill bar (log scale so 1 and 10,000 feel proportional) */}
          {typeof q === 'number' && q > 0 && (() => {
            const fill = Math.min(1, Math.log10(q + 1) / Math.log10(2001)); // 2000 units ≈ 100%
            return (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0, top: 0, bottom: 0,
                  width: `${fill * 100}%`,
                  background: `linear-gradient(90deg, ${meta.border.replace(/[\d.]+\)$/, '0.18)')} 0%, ${meta.border.replace(/[\d.]+\)$/, '0.06)')} 100%)`,
                  pointerEvents: 'none',
                }}
              />
            );
          })()}
          <span style={{ position: 'relative', zIndex: 1 }}>{row.stockQtyDisplay}</span>
        </span>
      );
    }

    // ── Unit price (spinner while loading) ──────────────────
    case 'unitPriceDisplay': {
      if (row.loaded === false) {
        return <span className="bog-spinner" aria-label="Loading price" />;
      }
      // Is a tier discount active on this line?
      const msrp = row.priceCents;
      const current = row.unitPriceCents;
      const discounted = current < msrp && row.qty > 0;
      if (!discounted) {
        return (
          <span style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 4,
            color: COLORS.text,
            fontWeight: 700,
            fontSize: 14,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {ctx.summaryMode && (
              <span style={{
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: '0.11em',
                textTransform: 'uppercase',
                color: COLORS.muted,
              }}>from</span>
            )}
            {row.unitPriceDisplay}
          </span>
        );
      }
      // Tier-discounted unit price — show strikethrough MSRP + discounted price + savings pct.
      const pct = Math.round(((msrp - current) / msrp) * 100);
      return (
        <span style={{
          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1,
          lineHeight: 1.1,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            fontSize: 13,
            color: COLORS.green,
          }}>
            {row.unitPriceDisplay}
            <span style={{
              padding: '1px 5px',
              borderRadius: 4,
              background: 'rgba(52,211,153,0.14)',
              border: '1px solid rgba(52,211,153,0.32)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: COLORS.green,
            }}>−{pct}%</span>
          </span>
          <span style={{
            fontSize: 10,
            color: COLORS.muted,
            textDecoration: 'line-through',
            textDecorationColor: 'rgba(255,255,255,0.32)',
            fontVariantNumeric: 'tabular-nums',
          }}
          title={`List: ${centsToDisplay(msrp)} — you save ${centsToDisplay(msrp - current)}/unit at this qty`}
          >
            {centsToDisplay(msrp)}
          </span>
        </span>
      );
    }

    // ── Line total ─ emphasized when the row has a qty ───────────
    case 'lineTotalDisplay': {
      if (row.loaded === false) {
        return <span className="bog-spinner" aria-label="Loading line total" />;
      }
      const hasQty = row.qty > 0;
      if (!hasQty) {
        // Teach the tier ladder in the empty state: show cheapest discounted tier preview.
        const tiers = (ctx.volumeTiers ?? []).filter((t) => t.discountPct > 0);
        const firstDiscountTier = tiers.sort((a, b) => a.minQty - b.minQty)[0];
        const canPreview =
          !!firstDiscountTier &&
          typeof row.priceCents === 'number' && row.priceCents > 0 &&
          (typeof row.stockQty !== 'number' || row.stockQty >= firstDiscountTier.minQty);
        if (!canPreview) {
          return <span style={{ color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>—</span>;
        }
        const q = firstDiscountTier.minQty;
        const discounted = Math.round(row.priceCents * (1 - firstDiscountTier.discountPct));
        const pct = Math.round(firstDiscountTier.discountPct * 100);
        return (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 9px', borderRadius: 7,
              border: '1px dashed rgba(255,255,255,0.14)',
              color: COLORS.muted,
              fontSize: 11, fontWeight: 500, letterSpacing: 0,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
            title={`Order ${q} of this SKU to unlock a ${pct}% per-line discount (— ${centsToDisplay(discounted)} per unit).`}
          >
            <span style={{ color: COLORS.muted, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Buy</span>
            <span style={{ color: COLORS.text, fontWeight: 700 }}>{q}+</span>
            <span>for</span>
            <span style={{ color: COLORS.green, fontWeight: 700 }}>−{pct}%</span>
          </span>
        );
      }
      // Active line total — emphasized badge, with subtle "next tier unlocks N%" hint when applicable.
      const activeTiers = (ctx.volumeTiers ?? []).slice().sort((a, b) => a.minQty - b.minQty);
      const currentTierIdx = activeTiers.findLastIndex((t) => row.qty >= t.minQty);
      const nextTier = currentTierIdx >= 0 && currentTierIdx < activeTiers.length - 1
        ? activeTiers[currentTierIdx + 1]
        : undefined;
      const showNextHint = nextTier && nextTier.discountPct > 0 && (typeof row.stockQty !== 'number' || row.stockQty >= nextTier.minQty);
      return (
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 10px',
              borderRadius: 8,
              background: 'rgba(122,162,247,0.10)',
              border: `1px solid rgba(122,162,247,0.30)`,
              color: COLORS.blue,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              fontSize: 13,
            }}
          >
            {row.lineTotalDisplay}
          </span>
          {showNextHint && (
            <span
              className="bog-next-tier-hint"
              style={{
                fontSize: 9.5,
                color: COLORS.muted,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
              title={`Order ${nextTier!.minQty} or more of this SKU on one line to unlock −${Math.round(nextTier!.discountPct * 100)}% off this line.`}
            >
              <span>+{(nextTier!.minQty - row.qty).toLocaleString()} more for </span>
              <span style={{ color: COLORS.green, fontWeight: 700 }}>−{Math.round(nextTier!.discountPct * 100)}% off line</span>
            </span>
          )}
        </div>
      );
    }

    // ── Generic read-only cell ─────────────────────────────────────────────
    default: {
      const value = (row as unknown as Record<string, unknown>)[col.key] ?? '—';
      return <span style={{ textAlign: textAlignFor(align) }}>{String(value)}</span>;
    }
  }
}

// ─── component ───────────────────────────────────────────────────────────────

export default function BulkOrderGrid({
  products = EMPTY_PRODUCTS,
  volumeTiers = DEFAULT_TIERS,
  onCreateQuote,
  onSaveAsList,
  loading,
  initialQtys = EMPTY_QTYS,
  initialTargetPrices,
  hideRowSelection = false,
  createQuoteLabel = 'Create Quote',
  showStockQty = false,
  enableTargetPrice = false,
  summaryMode = false,
  submitting = false,
  onSecondaryAction,
  secondaryActionLabel = 'Offer Quote',
  secondarySubmitting = false,
  onQuoteItemsChange,
  actionSlot,
  qtySetterRef,
  targetPriceSetterRef,
  externalSummary,
  onViewQuote,
  footerSlot,
  renderExpandedRow,
  renderImagePopover,
  virtualMode,
  sortState,
  onSortChange,
  onLoadMore,
  loadMoreThreshold = 1500,
  isLoadingMore = false,
}: BulkOrderGridProps) {
  const isVirtual = !!virtualMode;

  // Infinite-scroll for non-virtualized mode, row-buffer based. We track the
  // row index at the bottom of the viewport (approximated from scrollTop /
  // scrollHeight × products.length) and whenever fewer than
  // PREFETCH_BUFFER_ROWS rows remain below it, fire onLoadMore. Since
  // onLoadMore's state update causes a re-render that re-evaluates the
  // buffer, this chains naturally: after each page lands the effect re-runs
  // and fires again if the buffer is still short. Replaces the old
  // IntersectionObserver (single-shot; couldn't maintain a multi-page
  // buffer ahead of the user).
  const PREFETCH_BUFFER_ROWS = 200;  // keep ~2 pages of 100 rows beyond the viewport
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef<(() => void) | undefined>(onLoadMore);
  useEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);
  void loadMoreThreshold;  // kept on the props for backward compat; unused now

  const [visibleEndRow, setVisibleEndRow] = useState(0);
  useEffect(() => {
    if (isVirtual) return;
    const sc = scrollAreaRef.current;
    if (!sc) return;
    const n = products.length;
    const update = () => {
      if (n === 0 || sc.scrollHeight === 0) { setVisibleEndRow(0); return; }
      const ratio = Math.min(1, (sc.scrollTop + sc.clientHeight) / sc.scrollHeight);
      setVisibleEndRow(Math.floor(ratio * n));
    };
    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sc.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isVirtual, products.length]);

  useEffect(() => {
    if (isVirtual || !onLoadMore || isLoadingMore) return;
    if (products.length === 0) return;
    if (products.length - visibleEndRow < PREFETCH_BUFFER_ROWS) {
      onLoadMoreRef.current?.();
    }
  }, [isVirtual, onLoadMore, isLoadingMore, products.length, visibleEndRow]);
  const rowsRemainingBelowViewport = isVirtual ? Number.POSITIVE_INFINITY : Math.max(0, products.length - visibleEndRow);
  const showLoadMoreIndicator = !isVirtual && !!onLoadMore && products.length > 0 && (isLoadingMore || rowsRemainingBelowViewport < PREFETCH_BUFFER_ROWS);

  // ── State ────────────────────────────────────────────────────────────────

  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of products) init[p.id] = initialQtys[p.id] ?? 0;
    return init;
  });

  useEffect(() => {
    if (qtySetterRef) {
      qtySetterRef.current = (productId, qty) => {
        if (qty < 0) {
          quoteTouchedRef.current.delete(productId);
          setQtys((prev) => ({ ...prev, [productId]: 0 }));
        } else {
          setQtys((prev) => ({ ...prev, [productId]: qty }));
        }
      };
    }
    return () => { if (qtySetterRef) qtySetterRef.current = null; };
  }, [qtySetterRef]);

  useEffect(() => {
    if (targetPriceSetterRef) {
      targetPriceSetterRef.current = (productId, priceCents) => {
        setTargetPrices((prev) => ({ ...prev, [productId]: priceCents }));
      };
    }
    return () => { if (targetPriceSetterRef) targetPriceSetterRef.current = null; };
  }, [targetPriceSetterRef]);

  const [targetPrices, setTargetPrices] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of products) init[p.id] = initialTargetPrices?.[p.id] ?? p.priceCents;
    return init;
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [imagePopover, setImagePopover] = useState<{
    id: string; top: number; left: number; imgW: number; imgH: number;
  } | null>(null);
  const expandCollapseRef = useRef<number | null>(null);
  const imgCollapseRef = useRef<number | null>(null);

  const cancelExpandCollapse = useCallback(() => {
    if (expandCollapseRef.current !== null) {
      window.clearTimeout(expandCollapseRef.current);
      expandCollapseRef.current = null;
    }
  }, []);
  const scheduleExpandCollapse = useCallback(() => {
    cancelExpandCollapse();
    expandCollapseRef.current = window.setTimeout(() => setExpandedId(null), 180);
  }, [cancelExpandCollapse]);

  const cancelImgCollapse = useCallback(() => {
    if (imgCollapseRef.current !== null) {
      window.clearTimeout(imgCollapseRef.current);
      imgCollapseRef.current = null;
    }
  }, []);
  const scheduleImgCollapse = useCallback(() => {
    cancelImgCollapse();
    imgCollapseRef.current = window.setTimeout(() => setImagePopover(null), 140);
  }, [cancelImgCollapse]);

  // Clear transient UI state when the rendering mode flips (search <-> browse).
  // qtys / targetPrices are keyed by product.id and MUST persist across the
  // transition (WholesaleProcurementGrid drops its remount `key` specifically
  // so qtys survive), but expandedId/imagePopover/warnings index into the
  // *current* result set and are nonsensical against the new one.
  useEffect(() => {
    setExpandedId(null);
    setImagePopover(null);
    setWarnings({});
  }, [isVirtual]);

  // Close image popover on page scroll/resize — fixed-positioned against image rect.
  useEffect(() => {
    if (!imagePopover) return;
    const close = () => setImagePopover(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [imagePopover]);

  // Escape dismisses expanded row and image popover.
  useEffect(() => {
    if (!renderExpandedRow && !renderImagePopover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (expandedId !== null) { cancelExpandCollapse(); setExpandedId(null); }
      if (imagePopover !== null) { cancelImgCollapse(); setImagePopover(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renderExpandedRow, renderImagePopover, expandedId, imagePopover, cancelExpandCollapse, cancelImgCollapse]);

  // Touched = ever had qty > 0; emitted with qty=0 until explicitly trashed.
  const quoteTouchedRef = useRef<Set<string>>(new Set());

  // In virtual mode: accumulate metadata for products we've rendered at least once.
  // This lets onQuoteItemsChange emit items for products scrolled out of view.
  const knownProductsRef = useRef<Map<string, BulkOrderProduct>>(new Map());
  // Bumped whenever knownProducts gains an entry so memos relying on it re-run.
  const [knownProductsVersion, bumpKnownVersion] = useState(0);

  const productIdsKey = useMemo(
    () => (isVirtual ? '' : products.map((p) => p.id).join(',')),
    [products, isVirtual],
  );

  // Legacy mode: keep `products` prop mirrored into knownProducts so emit logic
  // sees every visible product.
  useEffect(() => {
    if (isVirtual) return;
    let added = false;
    for (const p of products) {
      const existing = knownProductsRef.current.get(p.id);
      if (!existing || existing !== p) {
        knownProductsRef.current.set(p.id, p);
        added = true;
      }
    }
    if (added) bumpKnownVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIdsKey]);

  // Seed qtys / targetPrices for products we've seen. Preserves user-entered
  // values across filter changes AND re-seeds when the underlying price
  // transitions from 0 (stock not yet loaded) to a real value — otherwise
  // the first render "sticks" a 0 target-price that the user never corrected.
  useEffect(() => {
    setQtys((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id] of knownProductsRef.current) {
        if (!(id in next)) {
          next[id] = initialQtys[id] ?? 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setTargetPrices((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, p] of knownProductsRef.current) {
        const existing = next[id];
        const seed = initialTargetPrices?.[id] ?? p.priceCents;
        // Seed on first appearance, OR when previous value was 0 (loaded-before-stock)
        // and we now have a non-zero price to use.
        if (existing == null || (existing === 0 && seed > 0)) {
          if (seed !== existing) {
            next[id] = seed;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [knownProductsVersion, initialQtys, initialTargetPrices]);

  // ── Row enrichment ───────────────────────────────────────────────────────

  const enrichRow = useCallback(
    (p: BulkOrderProduct): BulkOrderRow => {
      const qty = qtys[p.id] ?? 0;
      const unitPriceCents = applyVolumeDiscount(p.priceCents, qty, volumeTiers);
      const targetPriceCentsEditable = targetPrices[p.id] ?? p.priceCents;
      const lineTotalCents = targetPriceCentsEditable * qty;
      return {
        ...p,
        qty,
        unitPriceCents,
        lineTotalCents,
        unitPriceDisplay: centsToDisplay(unitPriceCents),
        lineTotalDisplay: qty > 0 ? centsToDisplay(lineTotalCents) : '—',
        targetPriceCentsEditable,
        targetPriceDisplay: centsToDisplay(targetPriceCentsEditable),
        stockQtyDisplay: typeof p.stockQty === 'number' ? String(p.stockQty) : '—',
        gradeDisplay: conditionToGrade(p.condition ?? ''),
        conditionDisplay: conditionToLabel(p.condition ?? ''),
      };
    },
    [qtys, targetPrices, volumeTiers],
  );

  // Legacy rendering source.
  const legacyRows: BulkOrderRow[] = useMemo(
    () => (isVirtual ? [] : products.map(enrichRow)),
    [products, enrichRow, isVirtual],
  );

  // ── Emit onQuoteItemsChange based on all KNOWN products ─────────────────
  useEffect(() => {
    if (!onQuoteItemsChange) return;
    // Mark any product currently with qty > 0 as touched.
    for (const [id, qty] of Object.entries(qtys)) {
      if (qty > 0) quoteTouchedRef.current.add(id);
    }
    const items: Parameters<NonNullable<typeof onQuoteItemsChange>>[0] = [];
    for (const [id, p] of knownProductsRef.current) {
      const qty = qtys[id] ?? 0;
      const touched = qty > 0 || quoteTouchedRef.current.has(id);
      if (!touched) continue;
      const unitPriceCents = applyVolumeDiscount(p.priceCents, qty, volumeTiers);
      const targetPriceCents = targetPrices[id] ?? p.priceCents;
      items.push({
        productId: id,
        productName: p.name,
        productImageUrl: p.imageUrl,
        condition: p.condition ?? '',
        qty,
        unitPriceCents,
        targetPriceCents,
        lineTotalCents: targetPriceCents * qty,
        stockQty: p.stockQty,
      });
    }
    onQuoteItemsChange(items);
  }, [qtys, targetPrices, volumeTiers, knownProductsVersion, onQuoteItemsChange]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleQtyChange = useCallback((productId: string, rawValue: string, maxQty?: number) => {
    const parsed = parseInt(rawValue, 10);
    let qty = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    const warnKey = productId + ':qty';
    if (maxQty !== undefined && qty > maxQty) {
      qty = maxQty;
      setWarnings((prev) => ({ ...prev, [warnKey]: `Max available is ${maxQty}` }));
    } else {
      setWarnings((prev) => { const n = { ...prev }; delete n[warnKey]; return n; });
    }
    setQtys((prev) => ({ ...prev, [productId]: qty }));
  }, []);

  const handleTargetPriceChange = useCallback((productId: string, rawValue: string, currentPriceCents?: number) => {
    const cleaned = rawValue.replace(/[$,]/g, '').trim();
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed) && parsed >= 0) {
      let cents = Math.round(parsed * 100);
      const warnKey = productId + ':price';
      if (currentPriceCents !== undefined && cents > currentPriceCents) {
        cents = currentPriceCents;
        setWarnings((prev) => ({ ...prev, [warnKey]: `We already offer a better price of ${centsToDisplay(currentPriceCents)}` }));
      } else {
        setWarnings((prev) => { const n = { ...prev }; delete n[warnKey]; return n; });
      }
      setTargetPrices((prev) => ({ ...prev, [productId]: cents }));
    }
  }, []);

  // ── Summary bar: from externalSummary or from currently visible rows ────

  // Visible-rows summary (fallback when externalSummary not provided).
  // In virtual mode, only visible rows count toward this; generally the parent
  // passes externalSummary for a cross-filter total.
  const summaryRows = useMemo(() => {
    const src = isVirtual
      ? virtualItemsWithRow()
          .map(({ row }) => row)
          .filter((r): r is BulkOrderRow => r !== undefined)
      : legacyRows;
    if (selectedIds.size === 0) return src;
    return src.filter((r) => selectedIds.has(r.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyRows, selectedIds, isVirtual, virtualMode?.virtualizer, enrichRow]);

  function virtualItemsWithRow() {
    if (!virtualMode) return [] as Array<{ index: number; row: BulkOrderRow | undefined }>;
    const items = virtualMode.virtualizer.getVirtualItems();
    return items.map((vi) => {
      const p = virtualMode.rowAt(vi.index);
      return { index: vi.index, row: p ? enrichRow(p) : undefined };
    });
  }

  const displayProductCount = externalSummary?.productCount ?? summaryRows.filter((r) => r.qty > 0).length;
  const displayTotalUnits = externalSummary?.totalUnits ?? summaryRows.reduce((s, r) => s + r.qty, 0);
  const displaySubtotalCents = externalSummary?.subtotalCents ?? summaryRows.reduce((s, r) => s + r.lineTotalCents, 0);
  const summaryLoading = externalSummary?.loading === true;
  // Per-line volume discounts apply by each row's own qty (not the cart total).
  // Track the largest single-line qty so the tier-progress rail reflects the tier
  // that is actually being priced into the line totals.
  const displayMaxLineQty = useMemo(() => {
    return summaryRows.reduce((m, r) => (r.qty > m ? r.qty : m), 0);
  }, [summaryRows]);
  const selectedWithQty = useMemo(() => summaryRows.filter((r) => r.qty > 0), [summaryRows]);

  function handleCreateQuote() {
    if (!onCreateQuote) return;
    onCreateQuote(
      selectedWithQty.map((r) => ({
        productId: r.id,
        qty: r.qty,
        unitPriceCents: r.unitPriceCents,
        lineTotalCents: r.lineTotalCents,
        targetPriceCents: r.targetPriceCentsEditable,
      })),
    );
  }

  function handleSecondaryAction() {
    if (!onSecondaryAction) return;
    onSecondaryAction(
      selectedWithQty.map((r) => ({
        productId: r.id,
        qty: r.qty,
        unitPriceCents: r.unitPriceCents,
        lineTotalCents: r.lineTotalCents,
        targetPriceCents: r.targetPriceCentsEditable,
      })),
    );
  }

  function handleSaveAsList() {
    if (!onSaveAsList) return;
    onSaveAsList(selectedWithQty.map((r) => ({ productId: r.id, qty: r.qty })));
  }

  // ── Columns + grid-template-columns ─────────────────────────────────────

  const columns = useMemo((): ColDef[] => {
    if (summaryMode) {
      // Group-level browse grid: only Product + aggregates. Widen Product
      // so long titles are readable; drop Grade (varies per variant),
      // Target Qty / Target Price / Line Total (purchase happens in the
      // expanded-row variant picker).
      const cols: ColDef[] = [
        { key: 'name', title: 'Product', width: 620, align: 'left', sortKey: 'name', defaultSortDir: 'asc' },
      ];
      if (showStockQty) cols.push({ key: 'stockQtyDisplay', title: 'In stock', width: 120, align: 'center', sortKey: 'availableQty', defaultSortDir: 'desc' });
      cols.push({ key: 'unitPriceDisplay', title: 'Unit Price', width: 150, align: 'center', sortKey: 'priceCents', defaultSortDir: 'desc' });
      return cols;
    }
    const cols: ColDef[] = [...STATIC_COLS];
    if (showStockQty) cols.push({ key: 'stockQtyDisplay', title: 'In stock',     width: 86,  align: 'center', sortKey: 'availableQty', defaultSortDir: 'desc' });
    cols.push({ key: 'unitPriceDisplay', title: 'Unit Price',   width: 125, align: 'center', sortKey: 'priceCents', defaultSortDir: 'desc' });
    cols.push({ key: 'qtyInput',         title: 'Target Qty',   width: 175, align: 'center' });
    if (enableTargetPrice) cols.push({ key: 'targetPriceInput', title: 'Target Price', width: 150, align: 'center' });
    cols.push({ key: 'lineTotalDisplay', title: 'Line Total',   width: 120, align: 'center' });
    return cols;
  }, [summaryMode, showStockQty, enableTargetPrice]);

  const gridTemplateColumns = useMemo(
    () => columns.map((c) => `${c.width}fr`).join(' '),
    [columns],
  );

  // ── Virtual-mode: keep knownProducts populated from the rowAt callback ──
  useEffect(() => {
    if (!virtualMode) return;
    const items = virtualMode.virtualizer.getVirtualItems();
    let added = false;
    for (const vi of items) {
      const p = virtualMode.rowAt(vi.index);
      if (!p) continue;
      const existing = knownProductsRef.current.get(p.id);
      if (!existing || existing.name !== p.name || existing.imageUrl !== p.imageUrl ||
          existing.priceCents !== p.priceCents || existing.stockQty !== p.stockQty) {
        knownProductsRef.current.set(p.id, p);
        added = true;
      }
    }
    if (added) bumpKnownVersion((v) => v + 1);
  });

  // ── Render ───────────────────────────────────────────────────────────────

  const rowEmpty =
    !loading &&
    (isVirtual
      ? (virtualMode?.estimatedTotal ?? 0) === 0 &&
        virtualMode!.virtualizer.getVirtualItems().length === 0
      : legacyRows.length === 0);

  const cellCtx: Omit<CellContext, 'row' | 'rowBg' | 'stockColor'> = {
    warnings,
    handleQtyChange,
    handleTargetPriceChange,
    renderImagePopover,
    setImagePopover,
    cancelImgCollapse,
    scheduleImgCollapse,
    volumeTiers,
    summaryMode,
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STEPPER_GLOBAL_CSS.replace(/gdg-stepper/g, 'bog-qty') }} />
      <style dangerouslySetInnerHTML={{ __html: `
        .bog-row[tabindex="0"]:focus-visible {
          box-shadow: inset 0 0 0 2px rgba(59,130,246,0.75);
          outline: none;
          background: ${COLORS.rowHover} !important;
        }
        @keyframes bog-shimmer {
          0%   { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
        .bog-shimmer {
          background: linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.03) 100%);
          background-size: 400px 100%;
          animation: bog-shimmer 1.2s linear infinite;
        }
        @keyframes bog-spin { to { transform: rotate(360deg); } }
        .bog-spinner {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.10);
          border-top-color: ${COLORS.blue};
          animation: bog-spin 0.7s linear infinite;
          vertical-align: middle;
        }
        .bog-header-sortable { transition: color 120ms ease, background 120ms ease, box-shadow 120ms ease; }
        .bog-header-sortable:hover { background: rgba(96,165,250,0.075); color: ${COLORS.text}; box-shadow: inset 0 -1px 0 rgba(96,165,250,0.35); }
        .bog-header-sortable:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(96,165,250,0.55); }
        input[type="text"]:focus, input[type="number"]:focus { border-color: ${COLORS.editBorder} !important; box-shadow: 0 0 0 3px rgba(96,165,250,0.20) !important; background: rgba(58,99,184,0.14) !important; }
        .bog-qty-pill:focus-within { box-shadow: 0 0 0 3px rgba(96,165,250,0.18); border-color: rgba(96,165,250,0.55) !important; }
        .bog-row:hover .bog-row-link { opacity: 1 !important; }
        .bog-row:hover .bog-thumb { transform: scale(1.045); }
        .bog-qty-btn { transition: background 120ms ease, color 120ms ease; }
        .bog-qty-pill:hover { background: rgba(255,255,255,0.08) !important; }
        .bog-row:hover .bog-thumb { border-color: rgba(96,165,250,0.50) !important; box-shadow: 0 6px 18px -10px rgba(96,165,250,0.7); }
        .bog-row { transition: background 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease; }
        .bog-row:hover { background: linear-gradient(90deg, rgba(96,165,250,0.075) 0%, rgba(52,211,153,0.028) 58%, transparent 100%) !important; box-shadow: inset 3px 0 0 rgba(96,165,250,0.65); }
        .bog-row:hover > div { background: transparent !important; }
        .bog-row:hover .bog-qty-chips { opacity: 1 !important; pointer-events: auto !important; }
        .bog-qty-chips > button:hover { background: rgba(96,165,250,0.18) !important; color: ${COLORS.text} !important; border-color: rgba(96,165,250,0.55) !important; }
        .bog-row:focus-within .bog-row-link { opacity: 0.9 !important; }
        .bog-primary-cta:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 16px 38px -14px rgba(59,130,246,0.95), inset 0 1px 0 rgba(255,255,255,0.30) !important; }
        .bog-primary-cta:active { transform: scale(0.985); }
        @media (hover: none), (max-width: 640px) {
          .bog-row .bog-row-link { opacity: 0.62 !important; color: rgba(147,197,253,0.95) !important; }
          .bog-row:active { background: linear-gradient(90deg, rgba(96,165,250,0.09) 0%, rgba(52,211,153,0.035) 58%, transparent 100%) !important; }
        }
        @media (max-height: 800px), (max-width: 640px) {
          .bog-row > div { padding-top: 8px !important; padding-bottom: 8px !important; font-size: 12px !important; }
          .bog-summary-bar { padding: 8px 12px !important; gap: 8px !important; flex-wrap: wrap !important; }
          .bog-summary-bar > span { padding: 4px 8px !important; font-size: 11px !important; }
          .bog-summary-bar button { padding-top: 7px !important; padding-bottom: 7px !important; font-size: 12px !important; }
        }
        @media (max-width: 640px) {
          .bog-summary-bar { align-items: stretch !important; flex-wrap: nowrap !important; gap: 6px !important; padding: 4px 6px !important; overflow-x: auto !important; scrollbar-width: none; }
          .bog-summary-bar::-webkit-scrollbar { display: none; }
          .bog-summary-bar > span { display: none !important; }
          .bog-summary-bar button { flex: 1 0 0 !important; min-width: 0 !important; justify-content: center !important; padding: 6px 7px !important; font-size: 11px !important; white-space: nowrap !important; }
        }
      `.replace(/\s+/g,' ') }} />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Scrollable area */}
        <div
          ref={(el) => {
            if (isVirtual) {
              if (virtualMode!.scrollRef) {
                (virtualMode!.scrollRef as { current: HTMLDivElement | null }).current = el;
              }
            } else {
              scrollAreaRef.current = el;
            }
          }}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: `linear-gradient(180deg, ${COLORS.bg} 0%, #0b101c 100%)` }}
        >
          {loading ? (
            <div style={{
              padding: '48px 24px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              color: COLORS.muted, fontFamily: COLORS.font, fontSize: 13,
            }}>
              <span className="bog-spinner" style={{ width: 22, height: 22, borderWidth: 2.5 }} />
              <div>
                <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 13 }}>Loading inventory…</div>
                <div style={{ marginTop: 3, fontSize: 11 }}>Syncing live stock + prices from the warehouse</div>
              </div>
            </div>
          ) : rowEmpty ? (
            <div style={{
              padding: '48px 24px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              color: COLORS.muted, fontFamily: COLORS.font, fontSize: 13, textAlign: 'center',
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, borderRadius: '50%',
                border: `1px dashed ${COLORS.border}`,
                background: 'rgba(255,255,255,0.02)',
              }}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.muted} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </span>
              <div>
                <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 14 }}>No products match your filters</div>
                <div style={{ marginTop: 4 }}>Try broadening the search, removing a grade filter, or clearing the price range.</div>
              </div>
            </div>
          ) : (
            <div style={{ width: '100%' }}>
              {/* Sticky header row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns,
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  background: `linear-gradient(180deg, rgba(16,24,39,0.98) 0%, rgba(10,15,26,0.98) 100%)`,
                  borderBottom: `1px solid rgba(96,165,250,0.24)`,
                  boxShadow: '0 12px 30px -24px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.045)',
                }}
              >
                {columns.map((col) => (
                  <HeaderCell
                    key={col.key}
                    col={col}
                    sortState={sortState ?? null}
                    onSortChange={onSortChange}
                  />
                ))}
              </div>

              {isVirtual ? (
                <VirtualRows
                  virtualMode={virtualMode!}
                  enrichRow={enrichRow}
                  columns={columns}
                  gridTemplateColumns={gridTemplateColumns}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  hideRowSelection={hideRowSelection}
                  hoveredId={hoveredId}
                  setHoveredId={setHoveredId}
                  expandedId={expandedId}
                  setExpandedId={setExpandedId}
                  cancelExpandCollapse={cancelExpandCollapse}
                  scheduleExpandCollapse={scheduleExpandCollapse}
                  renderExpandedRow={renderExpandedRow}
                  cellCtx={cellCtx}
                />
              ) : (
                legacyRows.map((row, i) => (
                  <BodyRow
                    key={row.id}
                    row={row}
                    rowIndex={i}
                    columns={columns}
                    gridTemplateColumns={gridTemplateColumns}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    hideRowSelection={hideRowSelection}
                    hoveredId={hoveredId}
                    setHoveredId={setHoveredId}
                    expandedId={expandedId}
                    setExpandedId={setExpandedId}
                    cancelExpandCollapse={cancelExpandCollapse}
                    scheduleExpandCollapse={scheduleExpandCollapse}
                    renderExpandedRow={renderExpandedRow}
                    cellCtx={cellCtx}
                  />
                ))
              )}

              {footerSlot}
            </div>
          )}

          {!isVirtual && showLoadMoreIndicator && (
            <div
              aria-live="polite"
              style={{
                position: 'sticky',
                bottom: 10,
                zIndex: 3,
                margin: '8px auto 10px',
                width: 'fit-content',
                maxWidth: 'calc(100% - 32px)',
                padding: '9px 13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                color: COLORS.text, fontFamily: COLORS.font, fontSize: 12, fontWeight: 600,
                border: `1px solid rgba(96,165,250,0.35)`,
                borderRadius: 999,
                background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(15,23,42,0.88))',
                boxShadow: '0 12px 30px -18px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04) inset',
                pointerEvents: 'none',
              }}
            >
              <span className="bog-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              {isLoadingMore ? 'Loading next products…' : 'Preparing next products…'}
            </div>
          )}

          {!isVirtual && isLoadingMore && (
            <div style={{
              padding: '14px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              color: COLORS.muted, fontFamily: COLORS.font, fontSize: 12,
            }}>
              <span className="bog-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              Loading next products…
            </div>
          )}
          {/* Infinite-scroll sentinel — observed via IntersectionObserver
              in non-virtualized mode. Always rendered so the observer ref
              is ready on mount; the callback checks onLoadMoreRef at fire
              time to respect enable/disable state. */}
          {!isVirtual && (
            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
          )}
        </div>

        {/* Tier-progress rail — horizontal bar with tier markers showing progress to the next volume-discount tier */}
        {(() => {
          if (summaryLoading) return null;
          const tiers = (volumeTiers ?? []).filter((t) => t.discountPct > 0).sort((a, b) => a.minQty - b.minQty);
          if (tiers.length === 0) return null;
          // Discounts apply per LINE (not per cart). The rail tracks the largest single-line qty,
          // because that's the line currently getting the deepest discount the buyer has unlocked.
          const units = displayMaxLineQty;
          if (units <= 0) return null;
          const maxTier = tiers[tiers.length - 1];
          const scaleMax = Math.max(maxTier.minQty * 1.05, units * 1.05, 10);
          const pct = Math.min(100, (units / scaleMax) * 100);
          const currentIdx = tiers.findLastIndex((t) => units >= t.minQty);
          const nextTier = currentIdx < tiers.length - 1 ? tiers[currentIdx + 1] : null;
          const toNext = nextTier ? nextTier.minQty - units : 0;
          const currentPct = currentIdx >= 0 ? Math.round(tiers[currentIdx].discountPct * 100) : 0;
          return (
            <div
              style={{
                position: 'relative',
                height: 36,
                padding: '0 20px',
                background: `linear-gradient(180deg, rgba(10,14,24,0.98) 0%, ${COLORS.headerBg} 100%)`,
                borderTop: `1px solid rgba(255,255,255,0.08)`,
                borderBottom: `1px solid rgba(255,255,255,0.06)`,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                fontFamily: COLORS.font,
              }}
            >
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
                color: COLORS.muted, flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                <svg aria-hidden="true" width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-5"/></svg>
                Best line:
                <strong style={{ color: COLORS.text, fontVariantNumeric: 'tabular-nums', fontSize: 11, letterSpacing: 0 }}>{units.toLocaleString()} units</strong>
              </span>
              <div style={{
                position: 'relative', flex: 1, height: 6,
                background: 'rgba(255,255,255,0.04)', borderRadius: 999,
                overflow: 'visible',
              }}>
                {/* Fill */}
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`,
                  borderRadius: 999,
                  background: currentIdx >= 0
                    ? `linear-gradient(90deg, rgba(52,211,153,0.55) 0%, ${COLORS.green} 100%)`
                    : `linear-gradient(90deg, rgba(96,165,250,0.35) 0%, ${COLORS.blue} 100%)`,
                  boxShadow: currentIdx >= 0 ? '0 0 10px rgba(52,211,153,0.35)' : '0 0 8px rgba(96,165,250,0.25)',
                  transition: 'width 0.45s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s',
                }} />
                {/* Tier markers */}
                {tiers.map((t) => {
                  const leftPct = Math.min(100, (t.minQty / scaleMax) * 100);
                  const reached = units >= t.minQty;
                  return (
                    <div key={t.minQty} style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    }}>
                      <span style={{
                        width: reached ? 10 : 8, height: reached ? 10 : 8,
                        borderRadius: '50%',
                        background: reached ? COLORS.green : 'rgba(255,255,255,0.08)',
                        border: `2px solid ${reached ? COLORS.green : 'rgba(255,255,255,0.22)'}`,
                        boxShadow: reached ? `0 0 0 3px rgba(52,211,153,0.14)` : 'none',
                        transition: 'all 0.25s',
                      }} />
                      <span style={{
                        position: 'absolute', top: 10, whiteSpace: 'nowrap',
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                        color: reached ? COLORS.green : COLORS.muted,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {t.minQty >= 1000 ? `${t.minQty/1000}K` : t.minQty} −{Math.round(t.discountPct * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
              <span style={{
                flexShrink: 0, fontSize: 11, fontWeight: 600,
                color: nextTier ? COLORS.text : COLORS.green,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {nextTier
                  ? <>Add <strong style={{ color: COLORS.blue }}>{toNext.toLocaleString()}</strong> to one line for <strong style={{ color: COLORS.green }}>−{Math.round(nextTier.discountPct * 100)}% off that line</strong></>
                  : <>✔ Best line at top tier (−{currentPct}%)</>
                }
              </span>
            </div>
          );
        })()}

        {/* Summary bar */}
        <div
          className="bog-summary-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 20px',
            background: `linear-gradient(180deg, rgba(14,20,33,0.99) 0%, rgba(8,12,22,0.99) 100%)`,
            borderTop: `1px solid rgba(255,255,255,0.11)`,
            boxShadow: '0 -22px 48px -34px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.045)',
            fontFamily: COLORS.font,
            fontSize: 13,
            color: COLORS.muted,
            flexShrink: 0,
          }}
        >
          {/* Stat chips on the left */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 11px',
            borderRadius: 999,
            border: `1px solid rgba(96,165,250,0.28)`,
            background: 'linear-gradient(180deg, rgba(96,165,250,0.11), rgba(96,165,250,0.055))',
            fontSize: 12,
          }}>
            <svg aria-hidden="true" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={COLORS.muted} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M3 6h18v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            {summaryLoading ? (
              <>
                <span className="bog-spinner" aria-label="Loading product count" />
                <span>loading draft…</span>
              </>
            ) : (
              <>
                <strong style={{ color: COLORS.text, fontVariantNumeric: 'tabular-nums' }}>{displayProductCount}</strong>
                <span>product{displayProductCount !== 1 ? 's' : ''} {selectedIds.size > 0 ? 'selected' : 'with qty'}</span>
              </>
            )}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 11px',
            borderRadius: 999,
            border: `1px solid rgba(52,211,153,0.28)`,
            background: 'linear-gradient(180deg, rgba(52,211,153,0.10), rgba(52,211,153,0.05))',
            fontSize: 12,
          }}>
            <svg aria-hidden="true" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={COLORS.muted} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            {summaryLoading ? (
              <>
                <span className="bog-spinner" aria-label="Loading unit count" />
                <span>loading draft…</span>
              </>
            ) : (
              <>
                <strong style={{ color: COLORS.text, fontVariantNumeric: 'tabular-nums' }}>{displayTotalUnits.toLocaleString()}</strong>
                <span>total units</span>
              </>
            )}
          </span>

          {/* Subtotal — big prominent readout */}
          <span style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'baseline', gap: 8,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: COLORS.muted,
            }}>Subtotal</span>
            {summaryLoading ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontSize: 14, color: COLORS.muted,
              }}>
                <span className="bog-spinner" style={{ width: 14, height: 14 }} aria-label="Loading subtotal" />
                <span style={{ fontSize: 12 }}>loading draft…</span>
              </span>
            ) : (
              <span style={{
                color: displaySubtotalCents > 0 ? COLORS.text : COLORS.muted,
                fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              }}>
                {centsToDisplay(displaySubtotalCents)}
              </span>
            )}
            {/* Tier-unlocked chip removed: it summed cart units but discounts are per-line, which was misleading. The tier-progress rail now shows the real per-line state. */}
          </span>

          {actionSlot}

          {onSaveAsList && (
            <button
              type="button"
              onClick={handleSaveAsList}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: COLORS.muted,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: COLORS.font,
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.22)';
                (e.currentTarget as HTMLButtonElement).style.color = COLORS.text;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.border;
                (e.currentTarget as HTMLButtonElement).style.color = COLORS.muted;
              }}
            >
              Save as List
            </button>
          )}
          {onViewQuote && (
            <button
              type="button"
              onClick={onViewQuote}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 16px',
                background: 'linear-gradient(180deg, rgba(96,165,250,0.16), rgba(96,165,250,0.09))',
                color: 'oklch(0.86 0.13 260)',
                border: '1px solid rgba(96, 165, 250, 0.46)',
                borderRadius: 12,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: COLORS.font,
                transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.12s',
              }}
              onMouseEnter={(e) => {
                const t = e.currentTarget as HTMLButtonElement;
                t.style.background = 'linear-gradient(180deg, rgba(96,165,250,0.22), rgba(96,165,250,0.12))';
                t.style.borderColor = 'rgba(96, 165, 250, 0.58)';
                t.style.color = '#f3f7ff';
                t.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                const t = e.currentTarget as HTMLButtonElement;
                t.style.background = 'linear-gradient(180deg, rgba(96,165,250,0.16), rgba(96,165,250,0.09))';
                t.style.borderColor = 'rgba(96, 165, 250, 0.46)';
                t.style.color = 'oklch(0.86 0.13 260)';
                t.style.transform = 'translateY(0)';
              }}
            >
              <svg aria-hidden="true" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
              View Quote
            </button>
          )}
          {onCreateQuote && (
            <button
              className="bog-primary-cta"
              type="button"
              onClick={handleCreateQuote}
              disabled={submitting}
              style={{
                padding: '11px 26px',
                background: 'linear-gradient(180deg, #60a5fa 0%, var(--primary, #3b82f6) 46%, #2563eb 100%)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.20)',
                borderRadius: 13,
                fontSize: 14,
                fontWeight: 800,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
                boxShadow: submitting ? 'none' : '0 14px 34px -14px rgba(59,130,246,0.9), inset 0 1px 0 rgba(255,255,255,0.28)',
                transition: 'opacity 0.2s, box-shadow 0.2s, filter 0.2s, transform 0.12s',
                fontFamily: COLORS.font,
              }}
            >
              {submitting ? 'Submitting…' : createQuoteLabel}
            </button>
          )}
          {onSecondaryAction && (
            <button
              type="button"
              onClick={handleSecondaryAction}
              disabled={secondarySubmitting}
              style={{
                padding: '9px 22px',
                background: '#d97706',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: secondarySubmitting ? 'not-allowed' : 'pointer',
                opacity: secondarySubmitting ? 0.7 : 1,
                boxShadow: secondarySubmitting ? 'none' : '0 4px 14px rgba(217,119,6,0.35)',
                transition: 'opacity 0.2s, box-shadow 0.2s',
                fontFamily: COLORS.font,
              }}
            >
              {secondarySubmitting ? 'Submitting…' : secondaryActionLabel}
            </button>
          )}
        </div>
      </div>
      {imagePopover && renderImagePopover && typeof document !== 'undefined' && createPortal(
        (() => {
          const p = knownProductsRef.current.get(imagePopover.id);
          if (!p) return null;
          const row = enrichRow(p);
          const POPOVER_W = 340;
          const POPOVER_H = 380;
          let left = imagePopover.left;
          if (left + POPOVER_W > window.innerWidth - 12) {
            left = Math.max(12, imagePopover.left - imagePopover.imgW - POPOVER_W - 16);
          }
          let top = imagePopover.top;
          if (top + POPOVER_H > window.innerHeight - 12) {
            top = Math.max(12, window.innerHeight - POPOVER_H - 12);
          }
          return (
            <div
              data-bog-image-popover
              onMouseEnter={cancelImgCollapse}
              onMouseLeave={scheduleImgCollapse}
              style={{
                position: 'fixed',
                top,
                left,
                zIndex: 1000,
                width: POPOVER_W,
                maxHeight: POPOVER_H,
                background: COLORS.headerBg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
                overflow: 'hidden',
                fontFamily: COLORS.font,
              }}
            >
              {renderImagePopover(row)}
            </div>
          );
        })(),
        document.body,
      )}
    </>
  );
}

// ─── Sortable header cell ────────────────────────────────────────────────────

interface HeaderCellProps {
  col: ColDef;
  sortState: SortState | null;
  onSortChange?: (next: SortState) => void;
}

function SortIcon({ state }: { state: 'inactive' | 'asc' | 'desc' }) {
  // Two stacked chevrons. Inactive fades both; active highlights the direction.
  const activeUp = state === 'asc';
  const activeDown = state === 'desc';
  const dim = COLORS.muted + '66'; // ~40% alpha
  const bright = COLORS.blue;
  return (
    <svg
      aria-hidden="true"
      width="9"
      height="13"
      viewBox="0 0 9 13"
      style={{ flexShrink: 0, marginLeft: 5 }}
    >
      {/* Up chevron */}
      <path
        d="M4.5 1 L8 5 L1 5 Z"
        fill={activeUp ? bright : dim}
      />
      {/* Down chevron */}
      <path
        d="M4.5 12 L1 8 L8 8 Z"
        fill={activeDown ? bright : dim}
      />
    </svg>
  );
}

function HeaderCell({ col, sortState, onSortChange }: HeaderCellProps) {
  const sortable = !!col.sortKey && !!onSortChange;
  const active = sortable && sortState?.column === col.sortKey;
  const iconState: 'inactive' | 'asc' | 'desc' = active ? sortState!.dir : 'inactive';

  const handleClick = () => {
    if (!sortable || !col.sortKey) return;
    if (active) {
      onSortChange!({ column: col.sortKey, dir: sortState!.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange!({ column: col.sortKey, dir: col.defaultSortDir ?? 'asc' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!sortable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const isEditGroupStart = col.key === 'qtyInput';
  const isEditGroup = col.key === 'qtyInput' || col.key === 'targetPriceInput' || col.key === 'lineTotalDisplay';

  const innerStyle: React.CSSProperties = {
    ...headerCellBase,
    justifyContent: justifyFor(col.align),
    borderBottom: 'none',
    cursor: sortable ? 'pointer' : 'default',
    color: active ? COLORS.text : headerCellBase.color,
    userSelect: 'none',
    ...(isEditGroupStart
      ? {
          borderLeft: `2px solid ${COLORS.editBorder}66`,
          boxShadow: `inset 1px 0 0 rgba(255,255,255,0.04)`,
        }
      : {}),
    ...(isEditGroup
      ? { background: `linear-gradient(180deg, rgba(58,99,184,0.10) 0%, rgba(58,99,184,0.04) 100%)` }
      : {}),
  };

  // Per-column leading icon to give the header row visual rhythm.
  const iconMap: Record<string, string> = {
    name:              'M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4v14h16zM10 5h4v2h-4z',
    conditionDisplay:  'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
    gradeDisplay:      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    stockQtyDisplay:   'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7 12 12M12 22V12M20.7 7 12 12',
    unitPriceDisplay:  'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    qtyInput:          'M9 3H5a2 2 0 0 0-2 2v4M14 3h5a2 2 0 0 1 2 2v4M21 14v5a2 2 0 0 1-2 2h-5M9 21H5a2 2 0 0 1-2-2v-4M8 12h8',
    targetPriceInput:  'M12 2v20M7 5h8a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h10',
    lineTotalDisplay:  'M3 3v18h18M3 9l4-4 4 4 6-6',
  };
  // Narrow columns (≤90px) skip the icon so text has room; wider ones get it.
  const iconPath = col.width >= 95 ? iconMap[col.key] : undefined;

  return (
    <div
      role={sortable ? 'button' : undefined}
      tabIndex={sortable ? 0 : undefined}
      aria-sort={active ? (sortState!.dir === 'asc' ? 'ascending' : 'descending') : (sortable ? 'none' : undefined)}
      onClick={sortable ? handleClick : undefined}
      onKeyDown={sortable ? handleKeyDown : undefined}
      style={innerStyle}
      className={sortable ? 'bog-header-sortable' : undefined}
    >
      {iconPath && (
        <svg
          aria-hidden="true"
          width={11}
          height={11}
          viewBox="0 0 24 24"
          fill="none"
          stroke={active ? COLORS.blue : COLORS.muted}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, marginRight: 4, opacity: 0.85 }}
        >
          {iconPath.split('M').filter(Boolean).map((d, i) => <path key={i} d={`M${d}`} />)}
        </svg>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.title}</span>
      {sortable && <SortIcon state={iconState} />}
    </div>
  );
}


// ─── Row sub-components ──────────────────────────────────────────────────────

interface BodyRowBaseProps {
  row: BulkOrderRow;
  rowIndex: number;
  columns: ColDef[];
  gridTemplateColumns: string;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  hideRowSelection: boolean;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
  cancelExpandCollapse: () => void;
  scheduleExpandCollapse: () => void;
  renderExpandedRow?: (row: BulkOrderRow) => ReactNode;
  cellCtx: Omit<CellContext, 'row' | 'rowBg' | 'stockColor'>;
}

function computeRowBg(
  rowIndex: number,
  isSelected: boolean,
  isHovered: boolean,
  _condition?: string,
): string {
  if (isSelected) return '#1a2540';
  if (isHovered) return COLORS.rowHover;
  if (rowIndex % 2 === 1) return COLORS.rowAlt;
  return COLORS.bg;
}

function computeStockColor(stockQty: number | undefined): string {
  if (typeof stockQty !== 'number') return COLORS.text;
  if (stockQty === 0) return COLORS.red;
  if (stockQty <= 3) return COLORS.amber;
  return COLORS.text;
}

function BodyRow({
  row,
  rowIndex,
  columns,
  gridTemplateColumns,
  selectedIds,
  setSelectedIds,
  hideRowSelection,
  hoveredId,
  setHoveredId,
  expandedId,
  setExpandedId,
  cancelExpandCollapse,
  scheduleExpandCollapse,
  renderExpandedRow,
  cellCtx,
}: BodyRowBaseProps) {
  const isSelected = selectedIds.has(row.id);
  const isHovered = hoveredId === row.id;
  const rowBg = computeRowBg(rowIndex, isSelected, isHovered, row.condition);
  const stockColor = computeStockColor(row.stockQty);

  return (
    <div
      className="bog-row"
      onClick={hideRowSelection ? undefined : () => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(row.id)) next.delete(row.id);
          else next.add(row.id);
          return next;
        });
      }}
      tabIndex={renderExpandedRow ? 0 : undefined}
      aria-expanded={renderExpandedRow ? expandedId === row.id : undefined}
      style={{
        cursor: hideRowSelection ? 'default' : 'pointer',
        outline: 'none',
        background: rowBg,
      }}
      onMouseEnter={() => {
        setHoveredId(row.id);
        if (renderExpandedRow) {
          cancelExpandCollapse();
          setExpandedId(row.id);
        }
      }}
      onMouseLeave={() => {
        setHoveredId(null);
        if (renderExpandedRow) scheduleExpandCollapse();
      }}
      onFocus={(e) => {
        if (!renderExpandedRow) return;
        if (e.currentTarget !== e.target) return;
        cancelExpandCollapse();
        setExpandedId(row.id);
      }}
      onBlur={(e) => {
        if (!renderExpandedRow) return;
        const next = e.relatedTarget as Node | null;
        const el = e.currentTarget;
        if (next && el.contains(next)) return;
        scheduleExpandCollapse();
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns, background: rowBg }}>
        {columns.map((col) => (
          <div
            key={col.key}
            style={{
              ...cellBase,
              justifyContent: justifyFor(col.align),
              background: rowBg,
              overflow:
                col.key === 'name' || col.key === 'qtyInput' || col.key === 'targetPriceInput'
                  ? 'visible'
                  : 'hidden',
              ...(col.key === 'qtyInput'
                ? {
                    borderLeft: `2px solid ${COLORS.editBorder}55`,
                    background: `linear-gradient(90deg, rgba(58,99,184,0.08) 0%, rgba(58,99,184,0.03) 100%)`,
                  }
                : {}),
              ...(col.key === 'targetPriceInput' || col.key === 'lineTotalDisplay'
                ? { background: 'rgba(58,99,184,0.05)' }
                : {}),
            }}
          >
            {cellContent(col, { ...cellCtx, row, rowBg, stockColor })}
          </div>
        ))}
      </div>
      {expandedId === row.id && renderExpandedRow && (
        <div
          onMouseEnter={cancelExpandCollapse}
          onMouseLeave={scheduleExpandCollapse}
          style={{
            background: COLORS.bg,
            borderTop: `1px dashed ${COLORS.border}`,
            borderBottom: `1px solid ${COLORS.border}`,
            boxShadow: 'inset 0 1px 0 rgba(59,130,246,0.18)',
          }}
        >
          {renderExpandedRow(row)}
        </div>
      )}
    </div>
  );
}

// Virtualized row list. Mounts only visible rows; uses measureElement so the
// expanded hover panel can dynamically change each row's measured height.
interface VirtualRowsProps {
  virtualMode: BulkOrderVirtualMode;
  enrichRow: (p: BulkOrderProduct) => BulkOrderRow;
  columns: ColDef[];
  gridTemplateColumns: string;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  hideRowSelection: boolean;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
  cancelExpandCollapse: () => void;
  scheduleExpandCollapse: () => void;
  renderExpandedRow?: (row: BulkOrderRow) => ReactNode;
  cellCtx: Omit<CellContext, 'row' | 'rowBg' | 'stockColor'>;
}

function VirtualRows({
  virtualMode,
  enrichRow,
  columns,
  gridTemplateColumns,
  selectedIds,
  setSelectedIds,
  hideRowSelection,
  hoveredId,
  setHoveredId,
  expandedId,
  setExpandedId,
  cancelExpandCollapse,
  scheduleExpandCollapse,
  renderExpandedRow,
  cellCtx,
}: VirtualRowsProps) {
  const virtualItems = virtualMode.virtualizer.getVirtualItems();
  const totalSize = virtualMode.virtualizer.getTotalSize();

  return (
    <div style={{ position: 'relative', height: totalSize, width: '100%' }}>
      {virtualItems.map((vi) => {
        const product = virtualMode.rowAt(vi.index);
        return (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualMode.virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {product ? (
              <BodyRow
                row={enrichRow(product)}
                rowIndex={vi.index}
                columns={columns}
                gridTemplateColumns={gridTemplateColumns}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                hideRowSelection={hideRowSelection}
                hoveredId={hoveredId}
                setHoveredId={setHoveredId}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
                cancelExpandCollapse={cancelExpandCollapse}
                scheduleExpandCollapse={scheduleExpandCollapse}
                renderExpandedRow={renderExpandedRow}
                cellCtx={cellCtx}
              />
            ) : (
              // Placeholder skeleton for a row whose data hasn't arrived yet.
              <div
                style={{
                  height: 60,
                  display: 'grid',
                  gridTemplateColumns,
                  borderBottom: `1px solid ${COLORS.border}`,
                  background: vi.index % 2 === 1 ? COLORS.rowAlt : COLORS.bg,
                }}
              >
                {columns.map((col) => (
                  <div key={col.key} style={{ ...cellBase, padding: '14px 16px' }}>
                    <div
                      className="bog-shimmer"
                      style={{ width: '60%', height: 12, borderRadius: 4 }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
