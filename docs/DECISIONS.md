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

## Auto-names follow Postgres's two namespaces, not the plan's single "per schema" rule

**Date & time:** 2026-10-24 (B7, uncommitted)

`assignNames` picks a free name for PK, unique and index objects among all relation names in the schema (tables, indexes, views, sequences, PK/unique names), and for FK and check objects among all constraint names in the schema, across tables. So a foreign key on `a(b_c)` and one on `a_b(c)` get `a_b_c_fkey` and `a_b_c_fkey1`. Validation (B5) still only requires constraint names to be unique per table, which is what Postgres enforces.

**Rationale:** this is what Postgres itself does when choosing a default name; a DB test over six scenarios (repeats, very long names, multibyte names, cross-table collisions, names already taken) matches it exactly on 14, 16 and 18. Breaking the namespace rule makes three scenarios fail.

## Auto-names are assigned in a fixed order

**Date & time:** 2026-10-24 (B7, uncommitted)

Objects are named in the order schema name, table name, kind (PK, unique, FK, check, index), column names, then id. Collision numbers depend on that order, not on object ids or when they were added.

**Rationale:** the plan asks for deterministic collision numbers. Objects can only collide with others of the same kind (the label differs), so the order across kinds has no effect on the result.

## Shared UTF-8 helpers

**Date & time:** 2026-10-24 (B7, uncommitted)

`model/utf8.ts` holds `utf8Length` and `clipUtf8`, used by both name validation and naming.

**Rationale:** both need Postgres's 63-byte limit counted in bytes, and one copy avoids drift.

## Introspection functions take a `Query`, and the snapshot is a helper around it

**Date & time:** 2026-10-24 (C1, uncommitted)

Every introspection function is `introspectX(query)`. `Query` is `(sql, params?) => Promise<Row[]>` with params limited to strings, numbers, booleans and null. `withSnapshot(query, fn)` wraps a run in `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` plus `SET LOCAL search_path = ''`, then commits, or rolls back and rethrows. The caller must give it a connection nothing else uses.

**Rationale:** core stays driver-free, and the empty search path makes `pg_get_expr` and `format_type` return schema-qualified text that matches across connections.

## Extension-owned objects are excluded in SQL, not after the fact

**Date & time:** 2026-10-24 (C2, uncommitted)

`notExtensionOwned(catalog, oidExpr)` is a SQL condition used by the schema, table, enum and unmodeled-object queries. `listExtensionOwned` is the same data as a list, for tests and diagnostics.

**Rationale:** one rule applied where the rows are read, with no separate filtering pass to forget.

## Everything on a read-only table is read-only

**Date & time:** 2026-10-24 (C4/C5/C6/C7, uncommitted)

A partitioned table or a partition makes its columns, constraints and indexes read-only too, with the table's reason (`partitioned-table` or `partition`). If a table is both, `partition` wins.

**Rationale:** the plan only marks the table, but nothing on a partition can be changed safely, and doing it once in introspection means the editor and the diff don't need to remember.

## Two more read-only reasons, and a few classification choices

**Date & time:** 2026-10-24 (C5/C6/C7, uncommitted)

Added `unsupported-type` (a column whose type has non-integer modifiers; its type is kept as the raw text) and `fk-set-columns` (Postgres 15+ `ON DELETE SET NULL (cols)`). A unique or primary key constraint is read-only for the same reasons as its backing index: INCLUDE columns, a non-default operator class, storage options or tablespace, NULLS NOT DISTINCT. Any non-default sort order (DESC, or NULLS FIRST/LAST) is `desc-index`. `NO INHERIT` only counts for check constraints, because Postgres marks every other constraint non-inheritable. Columns added in Postgres 15 and later are read through `to_jsonb(row) ->> 'column'`, which returns NULL on 14.

**Rationale:** the plan's rule is "any attribute pgsketch doesn't model makes an object read-only"; these are the attributes it doesn't model. Each was checked against a real Postgres.

## Index columns include everything the index touches when it is read-only

**Date & time:** 2026-10-24 (C7, uncommitted)

An editable index lists its key columns in order. A read-only one also lists the columns inside its expressions and predicate and its INCLUDE columns, so removing any of those columns is blocked.

**Rationale:** the diff's read-only guard needs to know every column an index depends on.

## Unmodeled objects link to what they read directly

**Date & time:** 2026-10-24 (C9, uncommitted)

Each view, materialized view, foreign table, sequence, trigger, function and policy records the tables and columns it depends on directly. A view on another view has no links of its own, because the view it reads already blocks the change. All sequences are kept, including those behind identity and serial columns, because their names are taken in the schema.

**Rationale:** enough for the guard and for name collisions, without walking dependency chains.

## Cast data is keyed by model type names

**Date & time:** 2026-10-24 (C10, uncommitted)

`CastData` holds type categories, domain base types and all of `pg_cast`, keyed by the same names `parsePgType` produces (`integer`, `varchar`, `public.mood`). `needsUsing` treats anything, arrays included, converting to a string type as not needing `USING`; an array never converts to a non-array otherwise; arrays follow their element types and domains their base type. The DB test compares it with Postgres for all 900 pairs of 30 types, using `ALTER COLUMN TYPE` on an empty table and an `INSERT ... SELECT`, which always agree.

**Rationale:** the first version missed that arrays convert to strings; the matrix found it. Types outside the matrix (ranges, geometric types) are only as accurate as `pg_cast`.

## Known gaps

**Date & time:** 2026-10-24 (C-phases, uncommitted)

A foreign key from a user table to an extension-owned table is returned with a reference to a table that is not in the model, which validation would report as missing. A table's own collation, `UNLOGGED`, and storage settings are not modeled and are not flagged. The Node driver does not parse arrays of the `name` type, so queries cast such columns to `text`.

**Rationale:** none of these showed up in the planned tests; noted so a later phase can decide.

## The fingerprint hashes the introspection queries' own inputs

**Date & time:** 2026-10-24 (D1, uncommitted)

`FINGERPRINT_SQL` is one statement made of one md5 per kind of object, each over rows rendered with `format('%L|...')` and sorted. It reuses the introspection building blocks (the user-schema, user-table and extension filters, the index read-only reason, and the unmodeled-object and dependency SQL) instead of restating them. It hashes OIDs and definition text (names, types, flags, defaults, constraint and index definitions, comments, enum labels), never statistics. Unmodeled objects contribute only OID, name, kind and dependencies. `ENABLE ROW LEVEL SECURITY` does not change it, because the flag itself is not read, only the policies.

**Rationale:** the fingerprint covers exactly what introspection reads by construction, so the two can only drift if a query is added without being added here, which D2 checks. It must be run on a connection with an empty `search_path`, like introspection, so definition text matches.

## The coverage guard captures the SQL that introspection really runs

**Date & time:** 2026-10-24 (D2, uncommitted)

Instead of scanning exported SQL constants, the test runs `introspectModel` with a spying `Query` that records every statement, then looks for the database's own catalog table names in that text and in the fingerprint SQL. The helpers are `catalogsRead` and `uncoveredCatalogs` in `fingerprint.ts`. Cast data is outside `introspectModel`, so it is excluded by construction, and a test asserts the fingerprint does not mention `pg_cast`.

**Rationale:** scanning what actually executes can't miss a query built from fragments, and matching real catalog names ignores functions like `pg_get_expr`.

## `introspect` is a snapshot around three reads

**Date & time:** 2026-10-24 (D3, uncommitted)

`introspectModel(query)` runs the seven model queries one after another. `introspect(query)` runs it, then the cast queries, then the fingerprint, all inside one `withSnapshot`, and returns `{ model, casts, fingerprint }`. The fixture `basic.sql` is checked by a snapshot of the model with ids replaced by names (`describeModel`), which is identical on Postgres 14, 16 and 18.

**Rationale:** the fingerprint must describe exactly the schema that was loaded; a test creates a table from another connection mid-introspection and checks it appears in neither the model nor the fingerprint.

## Each part of the diff returns operations and blocking errors together

**Date & time:** 2026-10-24 (E1–E5, uncommitted)

The plan writes `diff(baseline, desired): ChangeOp[]`. Each part (`diffSchemas`, `diffTables`, `diffColumns`, ...) returns a `DiffPart`, `{ ops, errors }`, and the final `diff` will concatenate the parts. Errors use the existing `ValidationError` type, so the editor shows them the same way as validation errors.

**Rationale:** the plan also needs the diff to report "blocking errors" (a table moved to another schema, a column a view depends on), and returning them next to the operations avoids a second pass.

## Edits the editor can't produce block generation instead of being ignored

**Date & time:** 2026-10-24 (E2/E3/E5, uncommitted)

Besides the plan's table-schema case, the diff reports a blocking error when an existing schema is renamed or removed (`schema-changed`) and when an existing column's identity is turned on, off or switched (`column-identity-changed`). None of these has an operation in 0.1.0.

**Rationale:** these are bugs if they ever happen, and a migration that silently leaves out a visible change is the worst failure the plan lists.

## Column change operations follow the order they run in

**Date & time:** 2026-10-24 (E4/E5, uncommitted)

A column that changes in several ways gets one operation per change: rename, type, default, nullability. A default counts as changed only when its SQL text changes, so a preset and a typed-in expression with the same text are the same default. Types are compared structurally, including length, precision and array-ness (`samePgType`). A new table's `createTable` carries its columns in table order and its primary key only; other constraints and indexes are separate operations.

**Rationale:** matches the operation phases in the plan (alter columns: type, defaults, nullability), and keeps the diff from reporting changes Postgres would not see.
