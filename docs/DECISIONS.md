# Decisions

Decisions made while building. The settled 0.1.0 decisions are in the build plan's Decisions table. Times are the commit time of the phase (UTC+6); entries marked "uncommitted" were made at the time of writing.

## TypeScript pinned to 6.0.x

**Date & time:** 2026-10-23 21:34 (A1)

The latest TypeScript (7.0.2) installed first, but `typescript-eslint` 8.72.0 refuses to run on it and `pnpm lint` crashed. `typescript` is pinned to `~6.0.0`, the range typescript-eslint supports.

**Rationale:** lint must work, and typescript-eslint does not support TS 7 yet. Revisit when it does.

## No `"type": "module"` in the desktop app

**Date & time:** 2026-10-24 00:39 (A3)

`apps/desktop/package.json` has no `"type"` field, so electron-vite builds the main and preload scripts as CommonJS (`index.js`).

**Rationale:** with `"type": "module"` the preload was built as `index.mjs` while the main process loads `index.js`, so the window opened with no `window.electron`. The plan's `sandbox: true` also requires a CommonJS preload.

## Preload is context-isolated only; template `sandbox: false` kept for now

**Date & time:** 2026-10-24 00:39 (A3)

The preload uses `contextBridge` only. The template's non-isolated fallback branch was removed. `sandbox: false` from the template stays in `src/main/index.ts` until phase I2.

**Rationale:** the fallback branch needed `@ts-ignore` and can never run under the security baseline. Switching to `sandbox: true` belongs with the typed preload bridge in I2.

## Renderer alias is `@/*`, not `@renderer/*`

**Date & time:** 2026-10-24 01:20 (A4)

The path alias in the desktop app is `@` and maps to `src/renderer/src` in `electron.vite.config.ts`, `tsconfig.json` and `tsconfig.web.json`.

**Rationale:** the shadcn CLI needs an `@/*` alias in `tsconfig.json`.

## shadcn initialised with the `radix-nova` preset through a temporary stub

**Date & time:** 2026-10-24 01:20 (A4)

`shadcn init` could not detect the electron-vite layout. It was run with a throwaway `vite.config.ts` stub (since deleted) and the `nova` preset on the `radix` base, which produced `components.json` with style `radix-nova`.

**Rationale:** the plan uses Radix popovers, and the stub was the smallest way to let the CLI generate the standard files.

## Electron binary download skipped in non-E2E CI jobs

**Date & time:** 2026-10-24 01:31 (A7)

The `check` and `db` jobs set `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. Only the `e2e` job downloads Electron.

**Rationale:** lint, typecheck, unit and DB tests never launch Electron, and the download costs minutes per job.

## Docker-based DB tests split from the default test run

**Date & time:** 2026-10-24 01:43 (A8)

DB tests are named `*.db.test.ts`. `pnpm test` excludes them and `pnpm --filter @pgsketch/core test:db` runs them. CI runs `test:db` as a Postgres 14-18 matrix.

**Rationale:** the default test run, and the first CI job, stay fast and don't need Docker.

## Unneeded dependency build scripts denied

**Date & time:** 2026-10-24 01:43 (A8)

`cpu-features`, `protobufjs` and `ssh2` are set to `false` under `allowBuilds` in `pnpm-workspace.yaml`.

**Rationale:** pnpm 12 blocks dependency build scripts and refuses the install until each is approved or denied. These come in through Testcontainers and nothing here needs their build steps.

## `unmodeledId` helper with a kind prefix

**Date & time:** 2026-10-24 (B2, uncommitted)

Unmodeled objects get IDs of the form `u:<kind>:<oid>`, for example `u:view:8`. The plan's ID list did not cover them.

**Rationale:** their OIDs come from different catalogs (`pg_proc`, `pg_trigger`, ...), so the same number could collide without the kind.

## Quoting rejects empty names and NUL, and uses `E'...'` for backslashes

**Date & time:** 2026-10-24 (B3, uncommitted)

`quoteIdent` throws on an empty name, and both quote functions throw on a NUL character. `quoteLiteral` emits an `E'...'` string with doubled backslashes whenever the value contains a backslash.

**Rationale:** Postgres cannot hold either of those characters, so the output would be invalid SQL. The `E'...'` form stays correct whether or not `standard_conforming_strings` is on, which a DB test checks against real Postgres.
