// @papercusp/grid-core — domain-agnostic datagrid primitives.
// Consumers outside this monorepo can depend on this package alone;
// @papercusp/grid adds shop-specific wrappers on top.

// Design tokens + theme
export {
  GRID_COLORS, glideTheme,
  EDIT_INPUT_STYLE, STEPPER_BTN_STYLE, STEPPER_PILL_STYLE, STEPPER_GLOBAL_CSS,
  TD_BASE, TH_BASE, TABLE_WRAPPER_STYLE, TABLE_STYLE, GRID_PANEL_STYLE,
  CHECKBOX_STYLE, STEPPER_INPUT_STYLE,
  badgeStyle, rowBg, stepperCSS, EXPAND_BTN_STYLE, SUB_ROW_STYLE,
} from './grid-theme';

// Column / formatter config
export * from './grid-config';

// Generic DataGrid shell (Glide)
export { default as DataGridShell } from './DataGridShell';
export type { ButtonDef, DataGridShellProps } from './DataGridShell';

// Declarative HTML GridTable + subrow
export { default as GridTable, GridSubTable } from './GridTable';
export type { GridTableProps } from './GridTable';

// Generic, DOM-based, column-config + arbitrary-JSX-cell datagrid.
// Use when you need rich custom cell rendering (color pills, hover popovers,
// stepper inputs, badges) plus optional virtualization. The shop-specific
// BulkOrderGrid is a specialization that composes this; harness panels can
// also adopt it directly.
export { default as RichGrid } from './RichGrid';
export type {
  RichGridProps,
  ColumnDef,
  CellRenderContext,
  ColumnAlign,
  SortState as RichGridSortState,
  SortDir as RichGridSortDir,
  VirtualMode as RichGridVirtualMode,
} from './RichGrid';

// Hover-expand state machine
export { useHoverExpand } from './use-hover-expand';

// Generic client-side sort helper for RichGrid consumers (small datasets;
// pushed into the data source for larger ones).
export { applySort } from './sort-util';
export type { UseHoverExpandOptions, HoverExpandHandle } from './use-hover-expand';
