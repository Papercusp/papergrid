# TESTING — papergrid

This is a meta-package for `bloom-grid` + `grid-core`. Each sub-package
ships its own tests; this README points at them.

## bloom-grid

- `src/rowStore.spec.ts` — row store add/update/delete + virtualization.
- `src/server.spec.ts` — server-rendering bloom-grid output.

Run: `npm test --workspace @restart/bloom-grid`.

## grid-core

- `src/sort-util.bench.ts` — Vitest bench for the sort hot path
  (testing-spec §1.12 micro-benchmarks).

Run benches: `npm run bench --workspace @restart/grid-core` (nightly).

## What they don't cover

- Visual rendering — verified ad-hoc via `verdict`. Lost Pixel
  baselines are Phase 4 and not yet wired.
- Cross-grid composition (RichGrid / DataGridShell consumers) — covered
  in operator + shop integration tests.

## Run after editing

| Edit touches                        | Run                                                   |
| ----------------------------------- | ----------------------------------------------------- |
| `bloom-grid/**`                     | `npm test --workspace @restart/bloom-grid`            |
| `grid-core/**` (logic)              | `npm test --workspace @restart/grid-core`             |
| `grid-core/**` (render hot path)    | `npm run bench --workspace @restart/grid-core`        |
| Shared types crossing into consumers| `npm run test:affected` from repo root                |

See repo-root `CLAUDE.md` and `apps/operator/content/docs/testing/` for the full strategy.
