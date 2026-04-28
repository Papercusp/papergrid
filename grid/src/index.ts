// @restart/grid — thin compat re-export of @restart/grid-core, kept for
// backward-compat while consumers gradually migrate to importing grid-core
// directly.
//
// Shop-domain helpers moved to `@restart/ui` on 2026-04-26 — they did not
// belong in the shared papergrid submodule. Update old imports:
//
//   - import { BulkOrderGrid }                  from '@restart/grid'
//   + import { BulkOrderGrid }                  from '@restart/ui'
//
//   - import { formatCentsForRegion, getClientRegion, type Region }
//                                               from '@restart/grid'
//   + import { formatCentsForRegion, getClientRegion, type Region }
//                                               from '@restart/ui'

// Everything from @restart/grid-core: theme tokens, GridTable, DataGridShell,
// grid-config, use-hover-expand, RichGrid.
export * from '@restart/grid-core';
