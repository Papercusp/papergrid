// @restart/grid — shop-specific grid surface.
//
// Re-exports the full domain-agnostic surface from @restart/grid-core so
// existing consumers (apps/web, apps/shop, libs/ui) don't have to change
// their imports. Adds the shop-specific BulkOrderGrid + region helpers.

// Region-aware client-side price formatter (reads <meta name="shop-region">).
export { getClientRegion, formatCentsForRegion } from './region';
export type { Region } from './region';

// Everything from @restart/grid-core: theme tokens, GridTable, DataGridShell,
// grid-config, use-hover-expand.
export * from '@restart/grid-core';

// Shop-specific bulk-order grid (wholesale procurement interface).
export { default as BulkOrderGrid, applyVolumeDiscount } from './BulkOrderGrid';
export type {
  BulkOrderGridProps,
  BulkOrderProduct,
  BulkOrderRow,
  VolumeDiscountTier,
  SortState,
} from './BulkOrderGrid';
