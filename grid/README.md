# @restart/grid

A thin **backward-compat re-export of [`@restart/grid-core`](../grid-core/README.md)**,
kept while consumers gradually migrate to importing `grid-core` directly.

```ts
// Everything from @restart/grid-core: RichGrid, DataGridShell, GridTable,
// applySort, useHoverExpand, theme tokens, …
export * from '@restart/grid-core';
```

## Status

This package adds no components of its own — it only forwards `@restart/grid-core`.
New code should import from `@restart/grid-core` directly; this alias exists so
existing `@restart/grid` imports keep resolving.

Shop-domain helpers (`BulkOrderGrid`, `formatCentsForRegion`, `getClientRegion`,
`Region`) moved to `@restart/ui` on 2026-04-26 — they did not belong in the
shared papergrid submodule. Update old imports:

```diff
- import { BulkOrderGrid } from '@restart/grid'
+ import { BulkOrderGrid } from '@restart/ui'
```

See the [`@restart/grid-core` README](../grid-core/README.md) for the full
component reference (RichGrid / DataGridShell / GridTable, sort + hover-expand
helpers, theme tokens).
