# TESTING — @restart/bloom-grid

## What this project's tests cover

- `src/rowStore.spec.ts` — row-store upsert/get/delete invariants.
- `src/server.spec.ts` — server-side bloom-filter helpers.

## What they don't cover

- React render path — covered indirectly when the grid is mounted by
  `@restart/grid` consumers.
- Browser flows — verified via the `verdict` skill.

## Run after editing

| Edit touches             | Run                                              |
| ------------------------ | ------------------------------------------------ |
| `src/**`                 | `npm test --workspace @restart/bloom-grid`       |
| Anything that imports it | `npm run test:affected` from repo root           |

See repo-root `CLAUDE.md` for the full testing strategy.
