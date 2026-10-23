# Decisions

Decisions made while building. The settled 0.1.0 decisions are in the build plan's Decisions table. Times are the commit time of the phase (UTC+6); entries marked "uncommitted" were made before the phase was committed.

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

**Date & time:** 2026-10-24 02:23 (B2)

Unmodeled objects get IDs of the form `u:<kind>:<oid>`, for example `u:view:8`. The plan's ID list did not cover them.

**Rationale:** their OIDs come from different catalogs (`pg_proc`, `pg_trigger`, ...), so the same number could collide without the kind.

## Quoting rejects empty names and NUL, and uses `E'...'` for backslashes

**Date & time:** 2026-10-24 02:23 (B3)

`quoteIdent` throws on an empty name, and both quote functions throw on a NUL character. `quoteLiteral` emits an `E'...'` string with doubled backslashes whenever the value contains a backslash.

**Rationale:** Postgres cannot hold either of those characters, so the output would be invalid SQL. The `E'...'` form stays correct whether or not `standard_conforming_strings` is on, which a DB test checks against real Postgres.

## Built-in type names use short SQL aliases in the model

**Date & time:** 2026-10-24 (B4, uncommitted)

`parsePgType` turns `format_type` text into `PgType` with the names the type picker offers: `varchar`, `bpchar`, `timestamp`, `timestamptz`, `time`, `timetz` and `varbit`. Other built-ins keep their `format_type` spelling (`integer`, `double precision`, `"char"`, `interval day to second`). Types with a schema keep their own name and are always quoted when rendered.

**Rationale:** the plan's examples and the risk tables use these short names, and each one renders back to valid SQL with the same meaning (for example `bpchar(10)` is `character(10)`). A DB test checks that parse then render gives the same `format_type` on real Postgres.

## Non-integer type modifiers are not representable and throw

**Date & time:** 2026-10-24 (B4, uncommitted)

`parsePgType` throws on modifiers like PostGIS `geometry(Point,4326)`, because `PgType.params` only holds integers. `renderPgType` also rejects built-in names that aren't plain lowercase words and parameters that aren't non-negative integers.

**Rationale:** failing loudly is safer than silently dropping the modifier, and rendering a name unquoted must never carry SQL. Phase C5 (columns query) has to catch this error and mark the column read-only; the plan has no read-only reason for it yet, so C5 will need to add one.

## Validation checks more than the plan lists, and skips read-only foreign keys

**Date & time:** 2026-10-24 (B5/B6, uncommitted)

`validateModel` also reports duplicate schema names and duplicate column names within a table, and treats constraint names as unique per table across all kinds (PK, unique, check, FK, exclusion), not just check and FK. Exclusion constraints join the relation namespace like PK and unique ones, since they create an index. Foreign keys that are read-only (deferrable, `NOT VALID`, `MATCH FULL`) are not checked for a target key or column types. A read-only unique index counts as an FK target unless it is partial, expression-based or not a B-tree, and for those a subset of its columns is enough.

**Rationale:** the plan's list leaves out obvious collisions Postgres rejects. Read-only objects are preserved as they are in the database, so an error on them would block SQL generation for a state that is already valid. A read-only index lists every column it touches (INCLUDE columns too), so exact matching would wrongly reject valid keys.

## Validation lives in three files; FK type compatibility is shared

**Date & time:** 2026-10-24 (B5/B6, uncommitted)

The plan puts validation in `model/validate.ts`. The name rules are in `model/validate-names.ts`, the error types in `model/errors.ts`, and the FK type rule in `model/fk-types.ts`.

**Rationale:** keeps each file short, and phase E10 (the FK type-change rule) needs the same compatibility check.

## FK type compatibility is a table taken from Postgres

**Date & time:** 2026-10-24 (B6, uncommitted)

`fkTypesCompatible(fkType, keyType)` is a directed table of built-in types, plus "same type, any length or precision". Numbers and times only go one way: an integer column can reference a numeric or float key but not the reverse, and `time` can reference `timetz` or `interval` but not the reverse. `text`, `varchar` and `bpchar` match each other, as do `date`, `timestamp` and `timestamptz`. Arrays and user-defined types (enums, domains) only match the exact same type. `test/fk-types.db.test.ts` checks all 676 pairs of 26 common types against real Postgres and passes on 14, 16 and 18.

**Rationale:** my first guess (two symmetric families) was wrong for 27 pairs. A wrong "incompatible" blocks a valid migration and a wrong "compatible" only shows up later in Validate, so the table follows what Postgres accepts. Types not in the matrix (for example `bit`, `inet`) only match themselves until they are tested.
