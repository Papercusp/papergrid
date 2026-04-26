// @restart/grid-core — domain-agnostic datagrid primitives.
// Consumers outside this monorepo can depend on this package alone;
// @restart/grid adds shop-specific wrappers on top.

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

// Hover-expand state machine
export { useHoverExpand } from './use-hover-expand';
export type { UseHoverExpandOptions, HoverExpandHandle } from './use-hover-expand';
