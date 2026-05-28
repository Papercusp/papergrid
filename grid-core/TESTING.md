# TESTING — @restart/grid-core

## What this project's tests cover

- `src/sort-util.bench.ts` — Vitest bench for `applySort` (the hottest
  pure function in the grid path). Numeric/string columns × 100/1k/10k
  rows, plus the null-state fast-path. Per testing-spec §1.12; runs
  in nightly CI (informational, not gating).

## What they don't cover (yet)

- Render-path benches for RichGrid row mount + cell-renderer churn —
  needs jsdom + @testing-library/react setup; planned next.
- Browser flows — verified ad-hoc via the `verdict` skill.

## Run after editing

| Edit touches                        | Run                                                   |
| ----------------------------------- | ----------------------------------------------------- |
| `src/sort-util.ts`                  | `npm run bench --workspace @restart/grid-core`        |
| Any source file                     | `npm test --workspace @restart/grid-core`             |
| Code that other workspaces depend on| `npm run test:affected` from repo root               |

See repo-root `CLAUDE.md` for the full testing strategy.
