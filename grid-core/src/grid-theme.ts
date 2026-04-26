/**
 * Shared visual design tokens for all grid components in @restart/grid.
 *
 * Both BulkOrderGrid (HTML table) and DataGridShell (Glide canvas grid) import
 * from here so a single colour/font change propagates everywhere.
 */
import type { Theme } from '@glideapps/glide-data-grid';

// ─── Palette ─────────────────────────────────────────────────────────────────

export const GRID_COLORS = {
  bg:         '#0f1422',    // base cell background — deeper, less blue-cast
  headerBg:   '#0a0e18',    // column header row — near-black for clear hierarchy
  rowAlt:     '#121828',    // every other row (subtle, almost flat for modern feel)
  rowHover:   '#1a2236',    // hover / focus highlight
  border:     '#1f2738',    // all dividers — softer, less saturated
  text:       '#e7ecf3',    // primary cell text — slightly warmer
  muted:      '#8a96ad',    // secondary / header text
  editBg:     '#162236',    // editable cell background
  editBorder: '#3b82f6',    // editable cell border (blue)
  amber:      '#fbbf24',
  red:        '#f87171',
  blue:       '#7aa2f7',
  green:      '#34d399',
  // Font stacks
  font:      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  monoFont:  'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

// ─── Glide Data Grid canvas theme ────────────────────────────────────────────

/** Drop-in theme for DataEditor — matches BulkOrderGrid's HTML-table look. */
export const glideTheme: Partial<Theme> = {
  bgCell:           GRID_COLORS.bg,
  bgCellMedium:     GRID_COLORS.rowAlt,   // every-other-row stripe
  bgHeader:         GRID_COLORS.headerBg,
  bgHeaderHasFocus: GRID_COLORS.rowHover,
  bgHeaderHovered:  GRID_COLORS.rowHover,
  textHeader:       GRID_COLORS.muted,
  textDark:         GRID_COLORS.text,
  textMedium:       GRID_COLORS.muted,
  textLight:        GRID_COLORS.muted,
  textBubble:       GRID_COLORS.text,
  borderColor:      GRID_COLORS.border,
  drilldownBorder:  GRID_COLORS.border,
  linkColor:        GRID_COLORS.blue,
  cellHorizontalPadding: 14,
  fontFamily:       GRID_COLORS.font,
  baseFontStyle:    '13px',
  headerFontStyle:  '600 11px',
};

// ─── Shared input / stepper styles ───────────────────────────────────────────

/** Styled text input for editable overlay cells (price, text fields). */
export const EDIT_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'rgba(58,99,184,0.08)',
  border: `1px solid ${GRID_COLORS.editBorder}55`,
  borderRadius: 8,
  color: GRID_COLORS.text,
  fontFamily: GRID_COLORS.font,
  fontSize: 13,
  fontWeight: 500,
  padding: '5px 12px',
  textAlign: 'center' as const,
  outline: 'none',
  boxSizing: 'border-box' as const,
  fontVariantNumeric: 'tabular-nums',
  transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
};

/** − / + circular button used in the quantity stepper. */
export const STEPPER_BTN_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: GRID_COLORS.text,
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
  fontFamily: GRID_COLORS.font,
  transition: 'background 0.12s',
};

/** Pill container that wraps − input + in the qty stepper. */
export const STEPPER_PILL_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 9999,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  padding: 3,
  gap: 0,
};

/** CSS to inject once per page — hides browser spin-button and hover states. */
export const STEPPER_GLOBAL_CSS = `
  .gdg-stepper-input::-webkit-outer-spin-button,
  .gdg-stepper-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .gdg-stepper-input { -moz-appearance: textfield; }
  .gdg-stepper-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08) !important; }
  .gdg-stepper-btn:disabled { opacity: 0.35 !important; cursor: not-allowed !important; }
`;

// ─── HTML table structural tokens ──────────────────────────────────────────

/** Base <td> style — spread and override background/textAlign per-cell. */
export const TD_BASE: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: `1px solid ${GRID_COLORS.border}`,
  fontFamily: GRID_COLORS.font,
  fontSize: 13,
  color: GRID_COLORS.text,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 0,
  fontVariantNumeric: 'tabular-nums',
};

/** Base <th> style — sticky header row. */
export const TH_BASE: React.CSSProperties = {
  ...TD_BASE,
  background: GRID_COLORS.headerBg,
  color: GRID_COLORS.muted,
  fontWeight: 600,
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  paddingTop: 12,
  paddingBottom: 12,
  position: 'sticky',
  top: 0,
  zIndex: 2,
  userSelect: 'none',
  borderBottom: `1px solid ${GRID_COLORS.border}`,
};

/** Outer wrapper div — rounded border container for <table>. */
export const TABLE_WRAPPER_STYLE: React.CSSProperties = {
  overflowX: 'auto',
  borderRadius: 8,
  border: `1px solid ${GRID_COLORS.border}`,
};

/** Full-page grid panel — rounded border container that wraps a canvas or HTML grid.
 *  Place outside the DataGridShell / BulkOrderGrid so title/filter bars can sit above.
 *  Assumes the parent is a flex column; the panel takes all remaining height via flex:1. */
export const GRID_PANEL_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  borderRadius: 10,
  overflow: 'hidden',
  border: `1px solid ${GRID_COLORS.border}`,
};

/** <table> element base style. */
export const TABLE_STYLE: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: GRID_COLORS.font,
  fontSize: 13,
};

/** Checkbox style for boolean columns. */
export const CHECKBOX_STYLE: React.CSSProperties = {
  width: 16,
  height: 16,
  accentColor: GRID_COLORS.green,
};

/** Stepper inner <input> — the number field between − and +. */
export const STEPPER_INPUT_STYLE: React.CSSProperties = {
  width: 44,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  textAlign: 'center' as const,
  fontFamily: GRID_COLORS.font,
  fontSize: 13,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
};

/** Badge style factory — colored pill for status/enum values. */
export function badgeStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: 999,
    background: color + '1f',
    border: `1px solid ${color}55`,
    color,
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: '0.04em',
    lineHeight: 1.2,
  };
}

/** Row-alternation background for the given index. */
export function rowBg(i: number): string {
  return i % 2 === 0 ? GRID_COLORS.bg : GRID_COLORS.rowAlt;
}

/** Generate scoped stepper CSS for a class prefix (default: 'gdg-stepper'). */
export function stepperCSS(prefix = 'gdg-stepper'): string {
  return STEPPER_GLOBAL_CSS.replace(/gdg-stepper/g, prefix);
}

// ─── Expandable row tokens ──────────────────────────────────────────────────

/** Expand/collapse chevron button in expandable rows. */
export const EXPAND_BTN_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 'none',
  background: 'transparent',
  color: GRID_COLORS.muted,
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 4,
  transition: 'color 0.12s, background 0.12s',
};

/** Container for expanded sub-row content. */
export const SUB_ROW_STYLE: React.CSSProperties = {
  background: GRID_COLORS.headerBg,
  borderLeft: `3px solid ${GRID_COLORS.editBorder}`,
  padding: '12px 16px',
};
