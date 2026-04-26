# papergrid

Generic data-grid building blocks: a thin wrapper around glide-data-grid plus
two specialized derivatives.

## Packages

- **`@restart/grid-core`** — The base `DataGridShell` wrapper around
  `@glideapps/glide-data-grid` with a simple `(headers, data)` interface and
  dot-path column resolution.
- **`@restart/grid`** — `BulkOrderGrid` built on top of `grid-core`. Region-aware,
  used for high-volume e-commerce ordering screens.
- **`@restart/bloom-grid`** — Search-driven grid (Bloom-filter optimized).

## Usage as a git submodule

```bash
git submodule add git@github.com:papercupai/papergrid.git libs/papergrid
```

Then in your root `package.json`:

```json
"workspaces": ["apps/*", "libs/*", "libs/papergrid/*"]
```
