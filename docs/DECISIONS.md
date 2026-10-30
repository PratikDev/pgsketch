# Decisions

Decisions made while building. The settled 0.1.0 decisions are in the build plan's Decisions table. Times are the commit time of the phase (UTC+6) or, for work not committed yet, the time it was done.

## TypeScript pinned to 6.0.x

**Date & time:** 2026-10-23 21:34 (A1)

The latest TypeScript (7.0.2) installed first, but `typescript-eslint` 8.72.0 refuses to run on it and `pnpm lint` crashed. `typescript` is pinned to `~6.0.0`, the range typescript-eslint supports.

**Rationale:** lint must work, and typescript-eslint does not support TS 7 yet. Revisit when it does.

## Strict TypeScript, Prettier for everything but `docs/`, and a minimal ESLint setup

**Date & time:** 2026-10-23 21:34 (A1)

The base TypeScript config is strict and also turns on `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Prettier uses single quotes and trailing commas, and `.prettierignore` lists `docs/`, so the plan and this log are formatted by hand while everything else, including `AGENTS.md`, is checked by `pnpm lint`. ESLint uses typescript-eslint's recommended rules only: no type-aware rules, and none of the template's React rules (`react-hooks`, `react-refresh`).

**Rationale:** one small config that works for both packages. Indexing that can return `undefined` is where most of the model code's bugs would hide, and prose tables in `docs/` should not be reflowed. The React rules were dropped with the template's own ESLint config and are worth adding once the renderer has real code.

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

## Desktop test setup

**Date & time:** 2026-10-24 01:29 (A5/A6)

Component tests run in Vitest with jsdom from their own `vitest.config.ts` (not the electron-vite config), with the setup file at `src/renderer/src/test-setup.ts`, next to the code, rather than the plan's `renderer/test-setup.ts`. `test:e2e` builds the app first because Playwright launches `out/main/index.js`. The window title is now `pgsketch` so the E2E spec has something to check.

**Rationale:** the renderer's source root is `src/renderer/src` in this template, and the E2E test must run the real build.

## Electron binary download skipped in non-E2E CI jobs

**Date & time:** 2026-10-24 01:31 (A7)

The `check` and `db` jobs set `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. Only the `e2e` job downloads Electron.

**Rationale:** lint, typecheck, unit and DB tests never launch Electron, and the download costs minutes per job.

## CI runs on every push and pull request, with a Postgres matrix and an xvfb E2E job

**Date & time:** 2026-10-24 01:45 (A7/A9)

`ci.yml` has three jobs on `ubuntu-latest`: `check` (lint, typecheck, unit and component tests), `db` (Postgres 14 to 18 with `fail-fast: false`, so one bad version doesn't hide the others) and `e2e` (under `xvfb-run --auto-servernum`). Node is 24 and pnpm comes from `packageManager`. The runner image is not pinned.

**Rationale:** the plan asks for these three checks, and an unpinned runner keeps security updates flowing at the cost of an occasional image change.

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

**Date & time:** 2026-10-24 02:36 (B4)

`parsePgType` turns `format_type` text into `PgType` with the names the type picker offers: `varchar`, `bpchar`, `timestamp`, `timestamptz`, `time`, `timetz` and `varbit`. Other built-ins keep their `format_type` spelling (`integer`, `double precision`, `"char"`, `interval day to second`). Types with a schema keep their own name and are always quoted when rendered.

**Rationale:** the plan's examples and the risk tables use these short names, and each one renders back to valid SQL with the same meaning (for example `bpchar(10)` is `character(10)`). A DB test checks that parse then render gives the same `format_type` on real Postgres.

## Non-integer type modifiers are not representable and throw

**Date & time:** 2026-10-24 02:36 (B4)

`parsePgType` throws on modifiers like PostGIS `geometry(Point,4326)`, because `PgType.params` only holds integers. `renderPgType` also rejects built-in names that aren't plain lowercase words and parameters that aren't non-negative integers.

**Rationale:** failing loudly is safer than silently dropping the modifier, and rendering a name unquoted must never carry SQL. Phase C5 (columns query) has to catch this error and mark the column read-only; the plan has no read-only reason for it yet, so C5 will need to add one.

## Validation checks more than the plan lists, and skips read-only foreign keys

**Date & time:** 2026-10-24 02:52 (B5/B6)

`validateModel` also reports duplicate schema names and duplicate column names within a table, and treats constraint names as unique per table across all kinds (PK, unique, check, FK, exclusion), not just check and FK. Exclusion constraints join the relation namespace like PK and unique ones, since they create an index. Foreign keys that are read-only (deferrable, `NOT VALID`, `MATCH FULL`) are not checked for a target key or column types. A read-only unique index counts as an FK target unless it is partial, expression-based or not a B-tree, and for those a subset of its columns is enough.

**Rationale:** the plan's list leaves out obvious collisions Postgres rejects. Read-only objects are preserved as they are in the database, so an error on them would block SQL generation for a state that is already valid. A read-only index lists every column it touches (INCLUDE columns too), so exact matching would wrongly reject valid keys.

## Validation lives in three files; FK type compatibility is shared

**Date & time:** 2026-10-24 02:52 (B5/B6)

The plan puts validation in `model/validate.ts`. The name rules are in `model/validate-names.ts`, the error types in `model/errors.ts`, and the FK type rule in `model/fk-types.ts`.

**Rationale:** keeps each file short, and phase E10 (the FK type-change rule) needs the same compatibility check.

## FK type compatibility is a table taken from Postgres

**Date & time:** 2026-10-24 02:52 (B6)

`fkTypesCompatible(fkType, keyType)` is a directed table of built-in types, plus "same type, any length or precision". Numbers and times only go one way: an integer column can reference a numeric or float key but not the reverse, and `time` can reference `timetz` or `interval` but not the reverse. `text`, `varchar` and `bpchar` match each other, as do `date`, `timestamp` and `timestamptz`. Arrays and user-defined types (enums, domains) only match the exact same type. `test/fk-types.db.test.ts` checks all 676 pairs of 26 common types against real Postgres and passes on 14, 16 and 18.

**Rationale:** my first guess (two symmetric families) was wrong for 27 pairs. A wrong "incompatible" blocks a valid migration and a wrong "compatible" only shows up later in Validate, so the table follows what Postgres accepts. Types not in the matrix (for example `bit`, `inet`) only match themselves until they are tested.

## Auto-names follow Postgres's two namespaces, not the plan's single "per schema" rule

**Date & time:** 2026-10-24 03:09 (B7)

`assignNames` picks a free name for PK, unique and index objects among all relation names in the schema (tables, indexes, views, sequences, PK/unique names), and for FK and check objects among all constraint names in the schema, across tables. So a foreign key on `a(b_c)` and one on `a_b(c)` get `a_b_c_fkey` and `a_b_c_fkey1`. Validation (B5) still only requires constraint names to be unique per table, which is what Postgres enforces.

**Rationale:** this is what Postgres itself does when choosing a default name; a DB test over six scenarios (repeats, very long names, multibyte names, cross-table collisions, names already taken) matches it exactly on 14, 16 and 18. Breaking the namespace rule makes three scenarios fail.

## Auto-names are assigned in a fixed order

**Date & time:** 2026-10-24 03:09 (B7)

Objects are named in the order schema name, table name, kind (PK, unique, FK, check, index), column names, then id. Collision numbers depend on that order, not on object ids or when they were added.

**Rationale:** the plan asks for deterministic collision numbers. Objects can only collide with others of the same kind (the label differs), so the order across kinds has no effect on the result.

## Shared UTF-8 helpers

**Date & time:** 2026-10-24 03:09 (B7)

`model/utf8.ts` holds `utf8Length` and `clipUtf8`, used by both name validation and naming.

**Rationale:** both need Postgres's 63-byte limit counted in bytes, and one copy avoids drift.

## Introspection functions take a `Query`, and the snapshot is a helper around it

**Date & time:** 2026-10-24 03:40 (C1)

Every introspection function is `introspectX(query)`. `Query` is `(sql, params?) => Promise<Row[]>` with params limited to strings, numbers, booleans and null. `withSnapshot(query, fn)` wraps a run in `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` plus `SET LOCAL search_path = ''`, then commits, or rolls back and rethrows. The caller must give it a connection nothing else uses.

**Rationale:** core stays driver-free, and the empty search path makes `pg_get_expr` and `format_type` return schema-qualified text that matches across connections.

## Extension-owned objects are excluded in SQL, not after the fact

**Date & time:** 2026-10-24 03:40 (C2)

`notExtensionOwned(catalog, oidExpr)` is a SQL condition used by the schema, table, enum and unmodeled-object queries. `listExtensionOwned` is the same data as a list, for tests and diagnostics.

**Rationale:** one rule applied where the rows are read, with no separate filtering pass to forget.

## Everything on a read-only table is read-only

**Date & time:** 2026-10-24 03:40 (C4/C5/C6/C7)

A partitioned table or a partition makes its columns, constraints and indexes read-only too, with the table's reason (`partitioned-table` or `partition`). If a table is both, `partition` wins.

**Rationale:** the plan only marks the table, but nothing on a partition can be changed safely, and doing it once in introspection means the editor and the diff don't need to remember.

## Two more read-only reasons, and a few classification choices

**Date & time:** 2026-10-24 03:40 (C5/C6/C7)

Added `unsupported-type` (a column whose type has non-integer modifiers; its type is kept as the raw text) and `fk-set-columns` (Postgres 15+ `ON DELETE SET NULL (cols)`). A unique or primary key constraint is read-only for the same reasons as its backing index: INCLUDE columns, a non-default operator class, storage options or tablespace, NULLS NOT DISTINCT. Any non-default sort order (DESC, or NULLS FIRST/LAST) is `desc-index`. `NO INHERIT` only counts for check constraints, because Postgres marks every other constraint non-inheritable. Columns added in Postgres 15 and later are read through `to_jsonb(row) ->> 'column'`, which returns NULL on 14.

**Rationale:** the plan's rule is "any attribute pgsketch doesn't model makes an object read-only"; these are the attributes it doesn't model. Each was checked against a real Postgres.

## Index columns include everything the index touches when it is read-only

**Date & time:** 2026-10-24 03:40 (C7)

An editable index lists its key columns in order. A read-only one also lists the columns inside its expressions and predicate and its INCLUDE columns, so removing any of those columns is blocked.

**Rationale:** the diff's read-only guard needs to know every column an index depends on.

## Unmodeled objects link to what they read directly

**Date & time:** 2026-10-24 03:40 (C9)

Each view, materialized view, foreign table, sequence, trigger, function and policy records the tables and columns it depends on directly. A view on another view has no links of its own, because the view it reads already blocks the change. All sequences are kept, including those behind identity and serial columns, because their names are taken in the schema.

**Rationale:** enough for the guard and for name collisions, without walking dependency chains.

## Cast data is keyed by model type names

**Date & time:** 2026-10-24 03:40 (C10)

`CastData` holds type categories, domain base types and all of `pg_cast`, keyed by the same names `parsePgType` produces (`integer`, `varchar`, `public.mood`). `needsUsing` treats anything, arrays included, converting to a string type as not needing `USING`; an array never converts to a non-array otherwise; arrays follow their element types and domains their base type. The DB test compares it with Postgres for all 900 pairs of 30 types, using `ALTER COLUMN TYPE` on an empty table and an `INSERT ... SELECT`, which always agree.

**Rationale:** the first version missed that arrays convert to strings; the matrix found it. Types outside the matrix (ranges, geometric types) are only as accurate as `pg_cast`.

## Known gaps

**Date & time:** 2026-10-24 03:40 (C-phases)

A foreign key from a user table to an extension-owned table is returned with a reference to a table that is not in the model, which validation would report as missing. A table's own collation, `UNLOGGED`, and storage settings are not modeled and are not flagged. The Node driver does not parse arrays of the `name` type, so queries cast such columns to `text`.

**Rationale:** none of these showed up in the planned tests; noted so a later phase can decide.

## The fingerprint hashes the introspection queries' own inputs

**Date & time:** 2026-10-24 04:03 (D1)

`FINGERPRINT_SQL` is one statement made of one md5 per kind of object, each over rows rendered with `format('%L|...')` and sorted. It reuses the introspection building blocks (the user-schema, user-table and extension filters, the index read-only reason, and the unmodeled-object and dependency SQL) instead of restating them. It hashes OIDs and definition text (names, types, flags, defaults, constraint and index definitions, comments, enum labels), never statistics. Unmodeled objects contribute only OID, name, kind and dependencies. `ENABLE ROW LEVEL SECURITY` does not change it, because the flag itself is not read, only the policies.

**Rationale:** the fingerprint covers exactly what introspection reads by construction, so the two can only drift if a query is added without being added here, which D2 checks. It must be run on a connection with an empty `search_path`, like introspection, so definition text matches.

## The coverage guard captures the SQL that introspection really runs

**Date & time:** 2026-10-24 04:03 (D2)

Instead of scanning exported SQL constants, the test runs `introspectModel` with a spying `Query` that records every statement, then looks for the database's own catalog table names in that text and in the fingerprint SQL. The helpers are `catalogsRead` and `uncoveredCatalogs` in `fingerprint.ts`. Cast data is outside `introspectModel`, so it is excluded by construction, and a test asserts the fingerprint does not mention `pg_cast`.

**Rationale:** scanning what actually executes can't miss a query built from fragments, and matching real catalog names ignores functions like `pg_get_expr`.

## `introspect` is a snapshot around three reads

**Date & time:** 2026-10-24 04:03 (D3)

`introspectModel(query)` runs the seven model queries one after another. `introspect(query)` runs it, then the cast queries, then the fingerprint, all inside one `withSnapshot`, and returns `{ model, casts, fingerprint }`. The fixture `basic.sql` is checked by a snapshot of the model with ids replaced by names (`describeModel`), which is identical on Postgres 14, 16 and 18.

**Rationale:** the fingerprint must describe exactly the schema that was loaded; a test creates a table from another connection mid-introspection and checks it appears in neither the model nor the fingerprint.

## Each part of the diff returns operations and blocking errors together

**Date & time:** 2026-10-24 04:11 (E1–E5)

The plan writes `diff(baseline, desired): ChangeOp[]`. Each part (`diffSchemas`, `diffTables`, `diffColumns`, ...) returns a `DiffPart`, `{ ops, errors }`, and the final `diff` will concatenate the parts. Errors use the existing `ValidationError` type, so the editor shows them the same way as validation errors.

**Rationale:** the plan also needs the diff to report "blocking errors" (a table moved to another schema, a column a view depends on), and returning them next to the operations avoids a second pass.

## Edits the editor can't produce block generation instead of being ignored

**Date & time:** 2026-10-24 04:11 (E2/E3/E5)

Besides the plan's table-schema case, the diff reports a blocking error when an existing schema is renamed or removed (`schema-changed`) and when an existing column's identity is turned on, off or switched (`column-identity-changed`). None of these has an operation in 0.1.0.

**Rationale:** these are bugs if they ever happen, and a migration that silently leaves out a visible change is the worst failure the plan lists.

## Column change operations follow the order they run in

**Date & time:** 2026-10-24 04:11 (E4/E5)

A column that changes in several ways gets one operation per change: rename, type, default, nullability. A default counts as changed only when its SQL text changes, so a preset and a typed-in expression with the same text are the same default. Types are compared structurally, including length, precision and array-ness (`samePgType`). A new table's `createTable` carries its columns in table order and its primary key only; other constraints and indexes are separate operations.

**Rationale:** matches the operation phases in the plan (alter columns: type, defaults, nullability), and keeps the diff from reporting changes Postgres would not see.

## A changed constraint or index is dropped and added; the plan's other rules hold

**Date & time:** 2026-10-24 04:13 (E6/E7)

Constraints and indexes are compared by id and by definition (kind, table, columns in order, check expression, foreign key target and actions, unique flag). A different definition gives `drop` then `add`, even if the name also changed; a different name alone gives a rename. A new table's primary key is part of its `createTable`; its other constraints and all its indexes are separate `add` operations. A table being dropped takes its constraints and indexes with it.

**Rationale:** Postgres can't alter either in place, and keeping the id-based rename means a rename is never turned into a recreate.

## Empty comments are the same as no comment

**Date & time:** 2026-10-24 04:14 (E8)

`diffComments` treats `''` and `null` as equal and always emits `null` for a cleared comment. New tables and columns that already carry a comment get a `setComment` after they are created.

**Rationale:** Postgres removes a comment set to an empty string, so comparing them would produce a change that reappears on every reload.

## Unmodeled objects record the table that owns them

**Date & time:** 2026-10-24 04:15 (E9)

`UnmodeledObject` has a new `ownerTableId`: the table a trigger or policy is on, null for everything else. `tableIds` still lists every table the object depends on, owner included.

**Rationale:** the read-only guard has to tell a trigger or policy that goes away with its own table from one on another table that reads it, and `tableIds` alone can't.

## The read-only guard is one pass over the finished operations

**Date & time:** 2026-10-24 04:15 (E9)

`guardReadOnly` removes any operation that would modify or recreate a read-only table, column, constraint or index (rename, retype, comment, or a drop plus add), and any drop of a table or column that a view, materialized view, policy, trigger or function still depends on, or that another table's read-only foreign key references. Each removal is a blocking error (`read-only-changed`, `read-only-dependency`). Sequences behind a column and foreign tables never block. A read-only foreign key on a table that is dropped too does not block. Read-only objects that go with their own table or column are dropped by ordinary `dropConstraint`/`dropIndex` operations, which still carry the object's `readOnly` reason, so the risk step (G) can flag them as destructive.

**Rationale:** one place enforces "never modified or recreated", so the other diff parts stay simple and no future operation can bypass it.

## The foreign key type rule compares the states in between

**Date & time:** 2026-10-24 04:16 (E10)

When both columns of a foreign key change type, the key is dropped and added again unless Postgres can compare each in-between pair (new foreign key type with old key type, and old with new). It uses the same compatibility table as validation (`fkTypesCompatible`). A key that also changed another way is left to the constraint diff.

**Rationale:** the alter statements can run in either order, so both in-between states must be valid, and reusing the verified table avoids a second set of type rules.

## The assembled diff adds a backstop and returns errors with the operations

**Date & time:** 2026-10-24 04:17 (E11)

`diff` runs the parts in this order: schemas, tables, columns, constraints, foreign key type changes, dangling foreign keys, indexes, comments. Then it applies the guard and concatenates all errors. The dangling-key step drops any foreign key still in the edited model whose target table or column is gone. The result has no particular order, since the renderer sorts it into phases.

**Rationale:** the editor normally removes those keys, and an explicit drop is safer than leaving it to Postgres.

## Known gaps in the diff

**Date & time:** 2026-10-24 04:17 (E6–E11)

A generated column that depends on a dropped column is not detected (the model doesn't record column-to-column dependencies); Validate would catch it. Triggers, policies and functions block a drop even when they would be harmless; this errs towards blocking.

**Rationale:** blocking too much is recoverable, and silently generating a failing migration is not.

## Source cleanup after reviewing the work against `AGENTS.md`

**Date & time:** 2026-10-24 11:32 (cleanup)

One `Oid` type (exported from `model/ids.ts`) replaces five copies. `relationEntries` in `model/lookup.ts` is the single list of what takes a name in a schema's relation namespace, used by name validation and by auto-naming. The five non-null assertions in `src` are gone: `baseKey` and `utf8Length` no longer need them, the FK rebuild check, the fingerprint query and the unmodeled-object mapping handle the empty case explicitly. The guards for impossible cases are gone too: a cap on domain chains (Postgres forbids cycles) and a fallback for unknown foreign key action codes, which are now a closed type. Tests share an `oidOf` helper and a diff-part runner.

**Rationale:** `AGENTS.md` asks for no duplicated logic, no assertions that bypass the type checker and no handling for impossible cases. Behavior is unchanged: the unit tests are identical and the DB tests are the same files.

## Rendering works from the two models, not from names inside the operations

**Date & time:** 2026-10-24 12:03 (F1/F3)

`orderOps` and the renderers take a `ModelPair` (`{ baseline, desired }`) next to the operations and look names up there. The plan's `render(ops, risks, context)` lists only the timestamp, database name and cast data in `context`, but operations carry ids, so something has to resolve schema, table and column names. The alternative was to put names in every operation; that would have changed all the E-phase operations.

**Rationale:** smallest change that makes qualified names available. Schema names come from the edited model (it has every schema, including ones created in the same migration); a table that exists before the migration is found in the loaded one.

## Operation order is phase, then name, with a fixed tie-break

**Date & time:** 2026-10-24 12:03 (F1)

`orderOps` puts each operation in one of the plan's twelve phases (all foreign key drops in 2, other drops in 3, foreign key adds in 11), then sorts by group, qualified name, step and finally operation kind. Renames run tables, columns, constraints, then indexes. One column's statements run as type, default, nullability and stay together. The name is only a sort key (`schema.table.column`).

**Rationale:** the plan asks for byte-identical SQL for identical changes. The operation-kind tie-break was added after a shuffle test found two operations on one column with the same key and a different order depending on the input.

## Renderers return statements without a trailing semicolon

**Date & time:** 2026-10-24 12:03 (F2/F3)

Each renderer returns `string[]`, one statement per entry and no `;`. The migration text (F7) adds the separators, and Validate can send each entry as one message.

**Rationale:** one operation can need more than one statement (later phases), and Validate sends them one at a time.

## Table statements: identity implies NOT NULL, DROP has no CASCADE

**Date & time:** 2026-10-24 12:03 (F3)

`columnDefinition` (in `render/columns.ts`, shared with F4's `ADD COLUMN`) leaves out `NOT NULL` on identity columns, since they are NOT NULL by themselves, and writes defaults as the normalized expression text. `CREATE TABLE` carries the columns and the primary key only. `DROP TABLE` has no `CASCADE`. A DB test runs the rendered schema, create, rename and drop statements on Postgres 14, 16 and 18 and checks what introspection finds.

**Rationale:** anything that depended on the table was dropped or blocked earlier, so a failing DROP means something was missed, and CASCADE would hide it.

## Statements use the names the object has when they run

**Date & time:** 2026-10-24 12:16 (F4/F5/F6)

A statement that runs before the renames (dropping a constraint or index) is written with the loaded schema's names; one that runs after them (adding, renaming, altering, commenting) uses the edited model's names, and a dropped column keeps its own name. Renaming runs tables first, so a column, constraint or index rename already sees the table's new name. `tableRef` and `columnName` in `render/names.ts` do this lookup; the renderers take a `RenderContext` (`ModelPair` plus cast data).

**Rationale:** this is the only way every statement refers to something that exists at that point of the migration. A DB test runs a migration that renames a table and then changes its columns and constraints, which only works if this is right.

## What the constraint, index and column statements write

**Date & time:** 2026-10-24 12:16 (F4/F5)

A type change gets `USING col::type` only when `needsUsing` says there is no assignment conversion. Foreign keys write `ON DELETE`/`ON UPDATE` only for actions other than NO ACTION. A check is written as `CHECK (expression)`, with extra parentheses so `a > 0 AND b > 0` stays one expression. An exclusion constraint is never rendered: it is read-only. Nothing is dropped with CASCADE. Defaults and check expressions are the database's normalized text, written as they are.

**Rationale:** SQL that says only what differs from Postgres's defaults is easier to read in a migration, and a failing DROP shows a missed dependency instead of hiding it.

## The migration text, and why risks are not a parameter yet

**Date & time:** 2026-10-24 12:16 (F7)

`renderMigration(ops, context)` returns `{ text, statements }`. The text is a header (generated by, time, database, operation count), a blank line, `BEGIN;`, each statement followed by `;` and a blank line, and `COMMIT;`. `statements` is the same list without semicolons, `BEGIN` or `COMMIT`, which Validate sends one at a time. Line breaks in the database name and timestamp are replaced by spaces, so a value can't end the comment line and start SQL. The plan writes `render(ops, risks, context)`; the risks parameter, the warning comments and the risk counts arrive with G3, when `assessRisk` exists.

**Rationale:** the file must be byte-identical for identical input, and a database name is attacker-controllable text that goes into a file the user will run. A reviewed snapshot of one migration with every kind of change covers the text, and a DB test runs a whole migration, with a rename plus column, constraint and index changes and a new schema, table and foreign key, on Postgres 14, 16 and 18.

## Type changes: only the plan's two lists are known, and plain `varchar` counts as the largest length

**Date & time:** 2026-10-24 23:16 (G1)

`classifyTypeChange(from, to)` returns `safe`, `lossy` or `may-fail`. Safe: `smallint` to `integer` to `bigint`; `varchar(n)` to a longer `varchar` or one with no length; `varchar` to `text`; `numeric` with more digits and the same scale; `text` to `varchar` with no length; and a column changed to exactly the same type. Lossy: a `numeric` scale decrease, a float to an integer, `timestamp`/`timestamptz` to `date`, and `text` to `varchar(n)`. Everything else is `may-fail`, including arrays, enums, domains and any schema-qualified type, narrowing an integer, shrinking a `varchar` length, `varchar` with no length to `varchar(n)`, `integer` to `real`, and `timestamp` to `timestamptz`.

**Rationale:** the plan says an unknown change must be a warning and never safe, so the classifier only says more than "may fail" for what the plan lists. Two readings are mine: plain `varchar` is a length larger than any `n` (so `text` to plain `varchar` loses nothing), and `text` to `varchar(n)` stays lossy as listed even though the SQL we write makes Postgres refuse too-long values instead of cutting them. The plan lists `text` to `varchar(n)` as lossy but not `varchar(20)` to `varchar(10)`, which is the same risk; that gap is left as the plan has it. Whether a change rewrites the table (the "slow" level) is not decided here.

## The classifier is checked against Postgres

**Date & time:** 2026-10-24 23:16 (G1)

A unit test goes through every ordered pair of 20 common types and requires exactly the listed pairs to be safe or lossy. A DB test runs 14 changes on real Postgres and checks that every pair called safe keeps its value and every pair called lossy changes it or is refused.

**Rationale:** the risk is calling something safe that is not, and only the database can say.

## What `assessRisk` flags, and what it leaves alone

**Date & time:** 2026-10-25 17:59 (G2)

`assessRisk(op, baseline)` returns a list of `{ level, message }` with level `destructive`, `may-fail`, `breaks-app` or `locks` (shown as "locks or slow"); no risks means safe. Dropping a table or column is destructive, and so is dropping a read-only constraint or index, which pgsketch can't recreate, named in the message. Renaming a table or column breaks app code. `setNotNull` may fail and scans the table. A new NOT NULL column with no default and no identity may fail. Adding a primary key, unique, check or foreign key constraint to a table that already exists may fail and scans the table; adding an index blocks writes. A type change is destructive if `classifyTypeChange` says lossy, may fail if it says may-fail, and also takes a lock if it rewrites the table. Constraints and indexes on a table created in the same migration are safe: it is empty. Everything else (renaming a constraint or index, defaults, dropping NOT NULL, comments, creating schemas and tables) is safe. Messages use the loaded schema's names, and `assessRisk` never throws, because it runs on every edit, even while the model is invalid.

**Rationale:** the plan's table, applied operation by operation. Two points are mine: a unique index may fail on duplicates just as a unique constraint does, and "the table rewrites" is decided by `typeChangeRewritesTable`, which says no rewrite only for the widenings that change a type modifier or share a representation (a longer `varchar`, `varchar` to `text`, `text` to plain `varchar`, more `numeric` digits at the same scale) and treats every other change as a rewrite. That can only add a warning, and a DB test checks the "no rewrite" claims against the table's file on disk.

## The migration computes its own risks, writes one warning per risk, and counts them in the header

**Date & time:** 2026-10-25 17:59 (G3)

`renderMigration(ops, context)` calls `assessRisk` for each operation, so there is no `risks` parameter (the plan's `render(ops, risks, context)`): a caller can't pass risks that don't match the operations, and the context already holds the loaded model. Each risk becomes a `-- WARNING (<level>): <message>` line above the first statement of its operation, in the order `assessRisk` returns them. The header gets a `-- Risks:` line counting risks (not operations) from worst to least, for example `3 destructive, 3 may fail, 2 breaks app code, 4 locks or slow`, or `none`. Warnings are only in the text; the statement list for Validate stays plain SQL. Line breaks in a message are replaced by spaces, because a message can contain a table or column name.

**Rationale:** the file is something the user reads and runs, so the dangerous statements should be marked where they are, and an object name must not be able to end a comment line and start SQL.

## Models are compared by names, and the first difference is reported as a sentence

**Date & time:** 2026-10-25 20:03 (H1)

`firstDifference(actual, expected)` turns each model into a list of objects keyed by qualified name (`schema "app"`, `column "app"."users"."id"`, `constraint …`, `index "app"."name"`) with everything about the object except its id, then compares them in the order of `expected`: schemas, enums, tables with their columns, constraints, indexes, then anything extra. It returns `Missing …`, `Different … expected … found …` or `Unexpected …`, or `null`; `matchesByName` is the boolean. Columns are compared as a list in table order plus each column's own facts, not by position number. A default is compared by its SQL text only, so a preset and a typed-in expression with the same text match, as in the diff. Read-only reasons and the saved `definition` of read-only constraints and indexes are compared too. Unmodeled objects are ignored. Names are only for display, so building them never throws on a half-edited model.

**Rationale:** the plan asks for this comparison by name and definition, with the first difference named. An extra column shows up as a difference in the table's column order rather than as "unexpected column", because the order fact is checked first; the message still names the table and lists both orders. Expressions are compared as written: normalizing them is phase H4.

## Round-trip tests: shared edit helpers, one database per case, and the invariant they check

**Date & time:** 2026-10-25 20:03 (H2, H3)

`test/edits.ts` holds `applyEdit`, which changes a model by names the way the editor will (add or drop a schema, table, column, key, index or foreign key, rename, retype, comment). It also does what the editor will do around an edit: dropping a column or table removes the constraints and indexes that use it and the foreign keys that point at it, identity and key columns become NOT NULL, new constraints and indexes are auto-named. `test/roundtrip.ts` runs one case: it creates a fresh database, runs the setup SQL, loads the schema, lets the test edit a copy, runs `assignNames`, validates, diffs, renders, runs the whole migration text in one go, loads the schema again and compares with `firstDifference`. A migration Postgres rejects, or edits that fail validation, throw with the SQL included. `test/roundtrip.db.test.ts` has 33 hand-written cases, and `test/roundtrip-property.db.test.ts` runs the same helper on random schemas and edits.

**Rationale:** the cascade and coupling rules belong to the editor stores (phases K4 and K7), which don't exist yet; the tests need them now to produce edits the editor could make. When the stores are built they should share this logic with `edits.ts` or replace it. A fresh database per case (`CREATE DATABASE`, dropped after) keeps cases independent without a container each.

## The property test: random schemas, edits chosen against the current model, runs set by an environment variable

**Date & time:** 2026-10-25 20:03 (H3)

`test/arbitraries.ts` draws a starting schema (one to four tables in `app` with one to five columns, optional primary key, unique constraint, index, identity, default, and a foreign key to an earlier table's key) and one to six edit intents. An intent doesn't name its target: three numbers choose among whatever exists when it is applied, so any intent list works on any schema and shrinks well. An intent with nothing to act on is skipped, and so is one that leaves the model invalid. `PGSKETCH_PROPERTY_RUNS` sets the number of runs (default 200; the nightly run will use 2,000), and `PGSKETCH_PROPERTY_SEED` with `PGSKETCH_PROPERTY_PATH` replays a failure. Types are limited to ones that can be converted into each other with `USING` on empty tables, defaults to values Postgres prints back unchanged, and a default is only kept across a type change inside the numbers. Not generated yet: check constraints, enums, read-only objects, turning identity on or off, and renames that take a name another rename is giving up (see below).

**Rationale:** normalization (H4, H5) isn't built, so the generator only produces expressions that need none. Rows aren't generated, so migrations that depend on data (NOT NULL, unique, USING casts) can't fail on it; that is covered by the hand-written cases and the G tests.

## What the round-trip tests found in core, and how it was fixed

**Date & time:** 2026-10-25 20:03 (H2, H3)

The property test failed on valid edits several times; each was reproduced as a fixed case and fixed in core.

- **Drops go before renames and new objects.** Phases are now: create schemas, drop foreign keys, drop other constraints and indexes, drop columns, drop tables, renames, create tables, add columns, alter columns, add constraints and indexes, add foreign keys, comments. Before, dropping a table and creating another with its name, dropping a column and adding or renaming another to its name, all failed with "already exists". `DROP COLUMN` is now written with the table's loaded name, since it runs before the table's rename.
- **New columns are added in the order of their positions**, not by name, so the table's column order after the migration is the edited one.
- **A default that is replaced while the type changes is dropped first and set again after.** Postgres casts the old default to the new type, which fails for a default that can't be cast (a text default on a column becoming an integer). Within a column the order is now drop default, type, set default, nullability.
- **A foreign key on a dropped table is dropped explicitly when it points at another table.** The table, key or column it points at may be dropped earlier than the table that owns the key, and Postgres refuses. A self-reference needs nothing.
- **A foreign key is rebuilt when a primary or unique key over its referenced columns is dropped or changed** (for example a primary key replaced by a unique constraint), since Postgres won't drop a key while a foreign key uses it. This is a new diff part, `diffFkKeyChanges`, next to the type-change rebuild; a foreign key already rebuilt for its types, or whose target is gone, is left to those.
- **Introspection listed too few indexes:** a unique index that a foreign key relies on was hidden because the query skipped any index named by `pg_constraint.conindid`, which a foreign key also sets. Only primary key, unique and exclusion constraints own their index.

**Rationale:** these are bugs in the plan's ordering and diff rules (the plan assumed table drops need no ordering because every foreign key was dropped earlier, and didn't cover names being freed). The plan's operation-order section is updated to match.

## Known limit: a rename that takes a name another rename is giving up

**Date & time:** 2026-10-25 20:03 (H3)

Renames run in name order, so renaming table `a` to `b` while `b` is renamed to `c` fails with "already exists", and swapping two names can't work without a temporary one. The same holds for columns, constraints and indexes. This is not handled in 0.1.0: the property generator avoids such renames (`heldByRenamed` in `test/arbitraries.ts`, marked with a `shortcut:` comment), and Validate shows the Postgres error before anything runs.

**Rationale:** ordering renames by dependency is small, but swaps need a temporary name and extra statements and warnings, which is a change of its own. A later phase can order renames by what they free and break swaps with a temporary name.

## `normalizeExpression` asks Postgres in a rolled-back temporary copy of the table

**Date & time:** 2026-10-25 20:46 (H4)

`normalizeExpression(query, expression, target, context)` returns `normalized` (the text and, for a check, the ids of the columns it uses), `invalid` (Postgres's own message) or `raw` (the text as typed, trimmed). `target` is a default on one column or a check; `context` is every column of the table, existing and pending, with its id, name and type, plus the connection's original `search_path`, which `currentSearchPath(query)` reads. It runs `BEGIN`; checks the role may create temporary tables (`has_database_privilege(…, 'TEMP')`, not in recovery, and the transaction not read-only); sets the user's `search_path` with `set_config(…, true)`; creates `pg_temp.pgsketch_expression` with a copy of every column; adds the expression with `ALTER TABLE … SET DEFAULT` or `ADD CONSTRAINT … CHECK`; sets an empty `search_path`; reads it back with `pg_get_expr` (the same call introspection uses, so the texts match); and always ends with `ROLLBACK`. An error while adding the expression is the `invalid` result; any other error is thrown.

**Rationale:** it follows the plan's five steps. Two details are mine. The privilege check runs first, instead of trying to create the table and matching a SQLSTATE, because core can't see the driver's error type and the check also covers a read-only replica or session. The default is added with `ALTER TABLE … SET DEFAULT` after the table exists, not inside `CREATE TABLE`, so the user's text is never inside the column list.

## The query function must send one statement per message

**Date & time:** 2026-10-25 20:46 (H4)

`normalizeExpression` documents that `query` has to use the extended protocol, and `test/pg.ts` has `extendedQuery(client)` and `TestPostgres.singleQuery` for it (`pg` takes `queryMode: 'extended'` but its types don't declare it, so the options object is built in a variable). Tests show both sides: `1; COMMIT; DROP TABLE …` as a default and `true); COMMIT; DROP TABLE …; --` as a check are `invalid` on the extended `Query` and leave the table alone; sent through the simple protocol on a separate connection, the same text really does run `COMMIT` and drop the table. The expression can still change the throwaway table (a payload can add a column to it), but never anything else, and a test checks that a function called in a default or check is never run.

**Rationale:** the plan only guarantees the `COMMIT` case, and that depends on how the caller sends the SQL, which core can't enforce. A first version of the injection test passed with the simple protocol too, because its payload failed type checking before the other statements ran; the control test and the boolean payload fix that, so the test now fails if the protocol changes.

## What "normalize alike" means, and the order of a check's columns

**Date & time:** 2026-10-25 20:46 (H4)

The plan says `CURRENT_TIMESTAMP` and `now()` "normalize alike". In Postgres they are different expressions (`CURRENT_TIMESTAMP` is read back as `CURRENT_TIMESTAMP`, `now()` as `now()`), so they stay different. The test instead checks that every way of typing one of them (`current_timestamp`, extra spaces, `NOW()`, `now ( )`) gives one text, and that the text is what a real table with that default reads back. A check's columns come back in the order Postgres stores them (`conkey`, the order they first appear in the expression), which is also the order introspection gives; sorting them by column position made the round trip report a difference for `hi > lo`.

**Rationale:** turning `now()` into `CURRENT_TIMESTAMP` is a real change to the column's default text, even though both give the current time, and merging them would hide it. The order matters because the comparison treats a check's column list as an ordered list.

## Round trips normalize what the user typed, as the editor will

**Date & time:** 2026-10-25 20:46 (H5)

`roundTrip` now calls `normalizeExpression` on every default whose text or column type changed and every new check before it names, validates and diffs the model, and uses `extendedQuery` for all its queries. Hand-written cases type defaults the way a user would (`CURRENT_TIMESTAMP`, a bare `'new'`, `4.50`, `uuid_generate_v4()` with the extension in `public`, an enum value, `1 + 2`) and add checks on one and several columns; one case types a column's current default in other forms (`NOW()`) and requires an empty migration. The property test now generates defaults as typed text and keeps them across type changes where they still make sense (a number to any convertible type, a string to another string type, either time type).

**Rationale:** the plan keeps only normalized text in the desired model, so the round trip has to do what the editor will, or every typed default would look like a phantom difference. A default is normalized again when its column's type changes because Postgres coerces it (`42` on an integer column becomes `'42'::text` when the column becomes text). Checks are only in the hand-written cases: a check keeps its text as typed, so renaming a column it uses leaves the edited text stale, which the editor has to handle (Postgres rewrites a stored check itself).

## Nightly property run

**Date & time:** 2026-10-25 20:46 (H6)

`.github/workflows/nightly.yml` runs only `roundtrip-property` on Postgres 14 to 18 (one job each, not stopping the others on a failure) at 02:17 UTC every day, with `PGSKETCH_PROPERTY_RUNS` set to 2,000, or to the `runs` input of a manual run. A failure prints its seed and path in the log; the `PGSKETCH_PROPERTY_SEED` and `PGSKETCH_PROPERTY_PATH` variables replay it.

**Rationale:** the plan's check for H6 is a manual trigger of the workflow, which needs the file to be on GitHub, so it is not marked done until that run passes. The same command with 2,000 cases was run locally on Postgres 16.

## A constraint that is rebuilt is not also renamed

**Date & time:** 2026-10-25 21:05 (H5)

When a foreign key is dropped and added again (its column types change, or the key it relies on is replaced) and it is also renamed, `diff` no longer emits the `renameConstraint`: the add already uses the new name, and the rename would run after the drop and fail with "constraint does not exist". It is a small pass in `diff()` over the collected operations, before the read-only guard, so it covers both rebuild reasons.

**Rationale:** found by the property test on Postgres 18 (a dropped unique index and a renamed foreign key in one edit), then added as a hand-written case and a diff test. The rename is dropped rather than the rebuild changed because the rebuild is needed whatever the name is.

## The IPC contract: schemas for inputs, types for results, and a `ping` channel

**Date & time:** 2026-10-25 22:21 (I1)

`shared/ipc-contract.ts` lists every channel of the plan's IPC table with a zod schema for its input, an `IpcResults` type for what it returns, and the two events (`schema:changed`, `connection:lost`) with their payload schemas. The schemas have no defaults or transforms, so what the renderer sends is what a handler receives (unknown fields are dropped). A channel with no input uses `z.void()` and is called with no arguments. Results that already exist in core are core's own types (`Introspection`, `CastData`, `NormalizedExpression`). The compiler checks that every channel has both a schema and a result type. A `app.ping` channel (echoes its message) is added for the bridge test; it is in the contract because the contract is what the preload lets through.

The shapes the plan only names are mine and can change when their phases come: connection parameters are `params` (host, port, user, optional password), `url` (the string) or `socket` (a directory starting with `/`), each with a database and an SSL mode, and `verify-full` requires a CA file path; session info carries the server version, database, host, a `local`/`remote`/`socket` kind and the `dbKey`; a saved connection has `hasPassword` and never the password; a draft is the fingerprint and the edited model as JSON text, which main stores without reading; Validate returns `stale` or a result per statement (`passed`, `failed` with message and code, or `not-run`); layout positions are a map from table id to `{x, y}`.

**Rationale:** only inputs are validated, as the plan says, so results need no runtime schema, and typing them from core avoids a second copy of the model. Draft JSON stays text because validating a whole model with zod would duplicate core's types for no gain: it is only read back by the renderer.

## The bridge is two generic functions, the preload is sandboxed, and the raw Electron API is gone

**Date & time:** 2026-10-25 22:21 (I2)

`registerIpc(ipc, channel, handler)` parses the raw payload with the channel's schema and calls the handler with the parsed value; a mismatch rejects with `IpcValidationError`, whose message names the channel and fields but never a value (a password may be among them). `main/ipc/index.ts` is the domain registry (a list of register functions; `app.ts` has `app.ping`), and `main/index.ts` calls `registerAllIpc(ipcMain)`. The preload exposes `window.api` with `invoke(channel, input)` and `on(event, listener)`, typed from the contract, instead of one function per channel; it refuses channels and events that aren't in the contract and passes listeners the payload without Electron's event. `createApi` lives in `preload/api.ts` so a test can drive it with a stand-in for `ipcRenderer` (`main/ipc/fake-ipc.ts` plays both sides and throws on a channel registered twice, as Electron does). `sandbox` is now `true`, so the preload bundles zod instead of requiring it (`externalizeDeps: false` for the preload only; the bundle is 188 kB). `window.electron` from `@electron-toolkit/preload` is no longer exposed, since it hands the renderer a raw `ipcRenderer`, and the package is removed. Vitest has two projects: `renderer` (jsdom) and `main` (node, for `main`, `preload` and `shared`), and both tsconfigs include `src/shared`. An e2e test runs a ping and a bad payload through the real preload, and checks the renderer has no `electron`, `require` or `process`.

**Rationale:** the build plan's security baseline says the preload exposes only the typed API and never raw `ipcRenderer`, and DECISIONS said the template's `sandbox: false` stays until this phase. Two generic functions keep the contract as the only list of channels, where one function per channel would be a second list to keep in step. The renderer's `api.ts` can wrap them with friendlier names later.

## The logger removes passwords from every line

**Date & time:** 2026-10-25 22:21 (I3)

`createLogger({ write, now })` gives `debug`, `info`, `warn` and `error`, each writing `<ISO time> <LEVEL> <message> <context as JSON>`. The message and every string in the context go through `redact`, which replaces the password in `scheme://user:password@host` (up to the last `@` before the path), and the value of `password=`, `sslpassword=` and `PGPASSWORD=` in a query string, a libpq string or an environment; the value of any context key containing `pass`, `secret`, `token`, `credential` or `private` is replaced whole. An `Error` is logged with its name, message, stack and cause, redacted. Line breaks in a message become a literal `\n`, so an entry is always one line. `fileSink` appends to a file (mode 600) in a folder made on the first line, and `defaultLogPath` is `~/.local/state/pgsketch/main.log`, or under an absolute `XDG_STATE_HOME`. The exported `log` does nothing until something writes to it, and nothing in `main` does yet.

**Rationale:** the plan says logs never contain passwords or full connection strings. Only the password is removed, so the host, user and database stay in the log where they help; a URL without a password is left as it is. The sink writes synchronously and never rotates, marked with a `shortcut:` comment: a session writes a few lines. Phase I10 decides where the data directory is and can route the log path through it.

## The app database uses `node:sqlite`, not `better-sqlite3`

**Date & time:** 2026-10-25 22:58 (I4)

The app database is opened with Node's built-in `node:sqlite` (`DatabaseSync`). The plan named `better-sqlite3` and listed `node:sqlite` as "to be revisited once stable"; this was asked and chosen. The plan's mentions (tech stack, services table, packaging, risks) are updated to match. The check that settled it: Electron 44 embeds Node 24.22 (ABI 149), the local Node is 25 (ABI 141) and CI uses Node 24 (ABI 137), and `better-sqlite3` is a native module built for one ABI, so unit tests under Node and the app under Electron would have needed separate builds and a rebuild step in every job. `node:sqlite` works under Vitest and inside Electron's main process (probed: migration files bundled, WAL on, `user_version` 1) with nothing to rebuild.

**Rationale:** it removes the native-module risk the plan listed for packaging. The cost is that the API is still a release candidate, so all use goes through `store/db.ts` and the repositories, and the packaged smoke test in CI is what proves it opens the database in the packaged app.

## Migrations are numbered SQL files bundled as text

**Date & time:** 2026-10-25 22:58 (I4)

`store/migrations/NNN_name.sql` files are found with `import.meta.glob` (as raw text, so they are inside the bundle and need no path at run time). `migrate(db)` runs each file above the database's `PRAGMA user_version` in its own transaction together with the version bump, so a failing step rolls back and leaves the earlier ones. A database whose version is higher than the newest file (from a newer pgsketch) is refused with a clear error and left alone. `openAppDb(path)` opens the file or `:memory:`, sets `journal_mode = WAL` and `foreign_keys = ON`, migrates, and closes the database again if anything fails. `001_init.sql` is the plan's schema as written. Where the file lives is I10's job.

**Rationale:** the plan fixes the mechanism (numbered files, `user_version`, those two pragmas); the glob avoids a list of files to keep in step, and refusing a newer database avoids silently running an old schema over new data.

## The connections repository stores what it can without secrets

**Date & time:** 2026-10-25 22:58 (I5)

`createConnectionsRepo(db)` has `add`, `get`, `list` (most recently used first, a tie going to the one saved later), `touch`, `remove` and `passwordEnc`. Rows are read through a zod schema, so a bad row fails loudly instead of being cast. `add` takes the connection parameters, a label and the already-encrypted password (or null); the password in the parameters is never read. A connection-string connection is stored with its URL through `splitConnectionUrl`, which removes the password (from the user info or `?password=`), `sslpassword` and `sslmode`, returns the password so the caller can encrypt it, and refuses anything that isn't a `postgres://` or `postgresql://` URL, with errors that never repeat the text. A `SavedConnection` has `hasPassword`, never the password; the ciphertext comes only from `passwordEnc(id)`. `remove` deletes the connection row only.

**Rationale:** the plan's test asks for the URL without password or `sslmode`; doing it in the repository means no caller can store them by forgetting to. Deleting a connection's drafts and layouts (`connection.forget`) waits for those repositories, because their key format (`dbKey`) belongs to session start. Saving the same connection twice makes two entries; whether to match an existing one is decided with the `connection.open` channel in I11.

## Passwords are encrypted only with a real system keyring

**Date & time:** 2026-10-25 22:58 (I6)

`createSecrets(safeStorage, isReady)` gives `problem()`, `encrypt` and `decrypt`. A password is only handled when the app is ready, `safeStorage` can encrypt, and the selected backend is one of `gnome_libsecret`, `kwallet`, `kwallet5` or `kwallet6`; otherwise `encrypt` and `decrypt` throw `SecretsUnavailableError` with the reason (`not-ready`, `unavailable` or `weak-backend`) and call nothing on `safeStorage`. Before ready, neither `isEncryptionAvailable` nor `getSelectedStorageBackend` is called. The check runs on every call, so a keyring that appears later is used. In the real Electron main process on this machine it reports `gnome_libsecret`.

**Rationale:** the plan says to refuse `basic_text` and `unknown`; an allow-list of keyrings refuses those and anything Electron adds later that isn't known to be safe. `decrypt` is guarded the same way because with a weaker backend it could not read ciphertext made with a keyring anyway. Nothing calls these yet; the connection channels (I11) will.

## Connection errors become messages in one place, matched on codes

**Date & time:** 2026-10-25 23:09 (I7)

`describeConnectionError(error, { host, port, user })` turns a failure into the message of the plan's table: `ECONNREFUSED` (and `ENOENT`, a missing socket file) gives "Couldn't reach Postgres at host:port. Is it running?"; `ENOTFOUND` and `EAI_AGAIN` give "Host not found"; a connection timeout gives "Connection timed out"; `28P01`, `28000` and `3D000` give the password, authentication and database messages; the server answering an SSL request with "no" gives the SSL message; Node's certificate error codes (and anything starting `ERR_TLS_CERT`) give the certificate message; and `UnsupportedVersionError` carries "pgsketch needs Postgres 14 or newer (found X)". Anything else is the first line of the driver's message with passwords removed (`redact`). `ConnectionError` is what the connection code throws: its message is ready to show and the original error is its `cause`.

**Rationale:** a signal is read from the error's `code`, never from words in a message, with two exceptions where the driver gives no code: the timeout (`Connection terminated due to connection timeout` or `timeout expired`, not the word "timeout" alone, so a lock or statement timeout in Validate isn't called a connection timeout) and the refused-SSL text, which is a constant. Added beyond the table: `ENOENT` for sockets and `EAI_AGAIN` for a DNS lookup that can't be answered.

## SSL modes are tried in order, and no `sslmode` ever reaches `pg`

**Date & time:** 2026-10-25 23:09 (I8)

`sslAttempts(mode, ca)` gives the `ssl` options to try: `disable` is `false`; `require` is `{ rejectUnauthorized: false }`; `verify-full` is `{ ca, rejectUnauthorized: true }` (Node also checks the host name) and needs the CA text; `prefer` is encrypted first and `false` second. The next attempt is made only when the server's answer to the SSL request was "no", so a wrong password or an unreachable host is reported as it is instead of being tried again in plaintext. A connection string is split into its parts (`splitConnectionUrl` removes the password and `sslmode`, `pg-connection-string` reads host, port and user) and the parts are passed to `pg`, never the string, so nothing in a URL can set SSL options. The CA file is read only for `verify-full`, and an unreadable one is "Couldn't read the CA certificate file".

**Rationale:** the plan says the selector is the only source of truth and that `pg`'s own parsing of the weaker modes can't be relied on. `pg-connection-string` is a direct dependency (pinned like `pg`) because the app now imports it.

## The main connection

**Date & time:** 2026-10-25 23:09 (I8)

`openMainConnection(params, { onLost })` returns `serverVersion`, `originalSearchPath`, `exclusive(work)`, `query` and `close`. It connects (5 s timeout, `application_name = 'pgsketch'`), checks `server_version_num` is at least 140000 and closes the connection if not, records the `search_path` with core's `currentSearchPath`, then runs `SET search_path = ''` (Postgres shows that as `""`). Every statement goes through `runSingle` (extended protocol, one statement per message); `runSingle` is in `services/run-single.ts` now because the main connection needs it, and I9 adds its test and the task connections. `exclusive` runs a function with the connection to itself and queues the next caller behind it, whether it fails or not; `query` is one statement queued the same way. A break in an open connection is passed to `onLost` once (`pg` can raise several errors for one break, and an unhandled one would crash the process) and not at all after `close`.

**Rationale:** `pg` queues single statements by itself, but a transaction is several, and core's snapshot helper needs the connection for all of them, so the queue has to be around whole sections. Reporting a loss once keeps the later `connection:lost` event from firing repeatedly.

## Desktop DB tests: their own project, helper and CI step

**Date & time:** 2026-10-25 23:09 (I8)

Desktop tests named `*.db.test.ts` are a third Vitest project (`db`, with the long container timeouts); `pnpm test` runs the renderer and main projects and `pnpm --filter @pgsketch/desktop test:db` runs the DB one, which the CI `db` job (Postgres 14 to 18) now runs after core's. `test/postgres.ts` starts a container (version from `PG_VERSION`), optionally with SSL: certificates are made with the `openssl` command (a CA, a server certificate for `localhost` only, and a second CA that signed nothing), and the key is installed by the entrypoint with the owner and mode Postgres insists on. The `ssl` tests use `localhost` for a match and `127.0.0.1` for a host-name mismatch. The Postgres 13 test starts its own server.

**Rationale:** it is a second small container helper next to core's, because the desktop tests need SSL and a chosen version and core's helper doesn't, and sharing one across packages would mean importing one package's tests from the other. The tests need Docker and `openssl`; both are on the CI runners.

## Task connections share the main connection's opener

**Date & time:** 2026-10-25 23:41 (I9)

`openConnection` (the former `openMainConnection`, renamed with `ServerConnection` and `ConnectionOptions`) opens both the main connection and task connections, so SSL, `application_name`, the version check and the `search_path` recording and pinning are the same code. `openTaskConnection` adds `rolledBack(work)`: `BEGIN`, the work, then `ROLLBACK` always (also when the work fails; a rollback on a broken connection is ignored), with the connection to itself meanwhile. It is for Validate's dry run; expression normalization runs core's `normalizeExpression`, which does its own `BEGIN` and `ROLLBACK`, on a task connection's `query`. Everything sent through `runSingle` is one statement per message. Tests: a transaction opened on a task connection is invisible to the main connection and gone after the rollback; `SELECT 1; SELECT 2`, `…; COMMIT` and `…; DROP TABLE` are refused with "multiple commands" and run nothing; a `COMMIT` can't be smuggled into a rolled-back section; and the same call on a plain `pg` client with no values really does run several statements, which is why `runSingle` exists. The 30-second idle close and the "at most three connections" rule are the normalizer's and Validate's to keep (M9, O phases).

**Rationale:** the plan says task connections have "the same settings" as the main one, and a second copy of the opener would drift. A section can't call the connection's own `query` (it would wait for itself), so work gets the `query` it is handed.

## Where the app keeps its files, and one instance per folder

**Date & time:** 2026-10-25 23:41 (I10)

`resolveAppPaths` gives the data folder, the database file and the log file. `PGSKETCH_DATA_DIR` puts all three in that folder (`pgsketch.db`, `main.log`); without it the data is under `~/.local/share/pgsketch` and the log under `~/.local/state/pgsketch`, following absolute `XDG_DATA_HOME` and `XDG_STATE_HOME`. `main/index.ts` reads it first, creates the folder (mode 700), makes it Electron's `userData` folder, and only then asks for `requestSingleInstanceLock`, which Electron scopes to that folder: a launch that doesn't get it quits, and one that does focuses its window when a second launch hands over. The app database is opened and the handlers registered once the app is ready. The exported `log` singleton in `log.ts` is gone: the logger is now made in `index.ts` with the log path from here. Every e2e test starts the app through `launchApp`, which gives it a folder of its own, so tests side by side and a developer's own copy never share a database, a log or the lock. The two new e2e tests start two instances with different folders, and a second launch with the same one, checking that it exits with code 0 and that the first instance receives the hand-over.

**Rationale:** the plan says all paths come from one folder with this override, and that the override also sets the user-data folder the lock belongs to. Putting the log in the same folder when overridden keeps a test's files together.

## The connection channels return a result instead of throwing

**Date & time:** 2026-10-25 23:41 (I11)

`connection.open` and `connection.openSaved` return `{ status: 'opened', session }` or `{ status: 'failed', message }`, as `connection.test` already did, instead of rejecting. Electron wraps a rejection's message as "Error invoking remote method 'x': ConnectionError: …", which the renderer would have to take apart. `SessionInfo` gained `saved`: the saved connection's id and `passwordNotSaved` (a password was given but there is no keyring to keep it), or null when the connection isn't saved. The handlers (`main/ipc/connection.ts`) take their dependencies as `IpcDeps` (the repository, secrets, the session, an event emitter and the function that opens connections), so unit tests run them with a fake connection; `registerAllIpc(ipc, deps)` passes them to every domain. The behavior:

- `open` connects first, then remembers if asked, so a connection that doesn't work is never saved. A password is encrypted only when `secrets.problem()` is null; otherwise the connection is still saved and opened, without the password, and `passwordNotSaved` says so. A connection string's password is taken out and encrypted like any other.
- `openSaved` decrypts the password in main and builds the parameters from the saved row (a URL gets its password put back inside it); the renderer gets a `SessionInfo` and never the password. A password that can't be read gives "Enter the password again" and doesn't connect. A saved connection moves to the top of the recent list when opened.
- The `dbKey` is `<saved id>:<database>` for a saved connection and a SHA-256 of host, port, user and database for one that isn't; `hostKind` is `socket` for a socket kind or a host starting with `/`, `local` for `localhost`, `127.0.0.1` and `::1`, `remote` otherwise.
- Opening another database closes the first only once the new one is open; a failure leaves the old one open. A connection that can't be saved is closed again.
- A connection that breaks by itself emits `connection:lost` once, with the reason redacted, and is forgotten; a connection that was already replaced reports nothing.
- `forget` removes the saved connection only; drafts and layouts wait for their repositories. Saving the same connection twice makes two entries.
- `defaults` gives the operating system user and `/var/run/postgresql`.

**Rationale:** the plan's table says "session info" and "OK or a mapped error"; a result object keeps the message clean. The e2e test of the saved-connection flow attaches to the app over the DevTools protocol (`launchWithKeyring`) because Playwright's own launcher starts Electron with `--password-store=basic`, which removes the keyring; on a machine with no keyring it skips itself with that reason, and the flow is also covered by unit tests with a fake keyring.

## Core is bundled into the main process

**Date & time:** 2026-10-25 23:41 (I11)

`electron.vite.config.ts` stops externalizing `@pgsketch/core` for the main process. The workspace package is TypeScript source with extension-less imports, so Node couldn't load it at run time (the app failed at startup with `ERR_MODULE_NOT_FOUND`); bundled, only what main uses (`currentSearchPath` for now) is included.

**Rationale:** the first run of the app with a runtime import of core is what showed it, and the e2e launch test caught it. Core has no runtime dependencies, so bundling it costs nothing else.

## The renderer's API client, and how the App switches screens

**Date & time:** 2026-10-25 23:55 (J1)

`renderer/api.ts` has one function per use of a connection channel (`api.connection.open(params, remember)`, `openSaved`, `recent`, `close`, `defaults`, `test`, `forget`), typed from the contract and calling `window.api.invoke` when it is called, not when the module loads, so a test can put its own in place (`test-utils.ts` has `installFakeApi`, which answers from a table and records each call). Only the connection channels are wrapped; each later screen adds the ones it uses. `App` holds the open session in state: no session shows Connect, an open one shows the Editor placeholder (the database, host and server version, a notice when a password could not be saved, and Disconnect, which calls `connection.close` and goes back). `shared/hosts.ts` has `isLocalHost`, now used by both the main process (the `hostKind` of a session) and the form (the SSL default), so the list of local hosts is in one place.

**Rationale:** one wrapper per channel in use keeps components from spelling channel names, and reading `window.api` late is what makes the component tests possible without a real preload. Plain state is enough for two screens; the stores of milestone K come when there is an editor to put in them.

## The Connect form

**Date & time:** 2026-10-25 23:55 (J2, J3)

The form (`screens/Connect/`) has three modes, as tabs: **Fields** (host, port, user, password, database), **Connection string** and **Local socket** (socket directory, port, user, database; choosing it fills the directory and the operating system user from `connection.defaults` and drops the password, and choosing it again doesn't overwrite what was edited). The SSL selector follows the host (`disable` for `localhost`, `127.0.0.1`, `::1`, a socket directory or a connection string pointing at one, `require` otherwise) until one is picked, and `verify-full` shows a field for the CA file. Pasting a connection string with `sslmode` sets the selector and removes it from the text (`allow` becomes `prefer`, `verify-ca` becomes `verify-full`, since those are the nearest of the four modes; an unknown value is removed and leaves the selector alone); the database comes from the string's path, and a string without one is an error on that field. Validation is a zod schema per mode in `connect-form.ts` with messages for people ("Enter a port between 1 and 65535"), shown under each field; the contract's schema in main is still the real check. Connect sends `connection.open` with the "Remember this connection" box (off by default); a failure shows the message from main in an alert and leaves the form as it was, and success leaves the screen. Recent connections are buttons above the form, most recent first, and one click calls `connection.openSaved` with its id; a failure to load the list or the defaults is ignored (the form still works). The code is split into the pure form logic (`connect-form.ts`), a hook for the screen's state (`use-connect-screen.ts`) and small components for the fields, SSL and recent list, with a shared `TextField`. shadcn components added: input, label, select, checkbox, card, alert, tabs; the tests polyfill what Radix needs in jsdom (`ResizeObserver`, pointer capture) and use `@testing-library/user-event`.

**Rationale:** the plan's connection-screen section, built on the contract from I1. The CA file is a text field with a path because the contract has no file-dialog channel and the sandboxed renderer can't read a chosen file's path; a native picker can come with the file service. Not built, because it wasn't asked for: forgetting a recent connection from the list, a Test button for `connection.test`, and showing that a password could not be saved anywhere but the placeholder Editor.

## Plan change: the Connect form moves to TanStack Form (J4 to J7)

**Date & time:** 2026-10-26 22:00

The build plan gains four phases after J3 and the phase count goes from 121 to 125: J4 a show/hide toggle on password fields (`PasswordInput`, shadcn `input-group`), J5 one zod schema (a union by mode) that checks each field and produces the connection parameters, J6 a `FormTextField` for a TanStack form field (shadcn `field`), and J7 the form itself on `useForm`. The tech stack, the connection-screen section and the repository structure in the plan are updated to match. Decisions behind it: the password stays optional, and a server that wants one says so in its own words (the error table is not extended); fields that react to each other use TanStack field listeners (the socket mode fill and a pasted connection string's `sslmode`), while the SSL default that follows the host is worked out from the host instead of being a listener; the submit handler parses the values with the schema to get the connection parameters; a failure from `connection.open` or `openSaved` is set on the form with `setErrorMap` and clears on the next edit.

**Rationale:** checked in a scratch project with `@tanstack/form-core` 1.33.5 and zod 4.6.7: `onSubmit` receives the raw values, not the schema's transformed output (so it parses again); listeners can set other fields and also fire when a field is set from code, so they have to be idempotent; `setErrorMap` from `onSubmit` shows a form-level error that clears on an edit. J7 is over the three-file limit and deletes two files, since the old and new forms can't both drive the same fields; the old `TextField` is replaced by `FormTextField` rather than changed in place for the same reason.

## Show and hide on password fields (J4)

**Date & time:** 2026-10-26 22:09

`PasswordInput` is shadcn's `InputGroup` with the input and a trailing icon button (Eye or EyeOff from lucide), masked until the button is pressed. The button is a real button (`type="button"`, so it never submits the form) with `aria-label` "Show password" or "Hide password" and `aria-pressed`, and is reached by Tab. It is used for any password field. The e2e locator for the password became `getByLabel('Password', { exact: true })`, since Playwright matches labels by substring and the button's name contains "password".

## The Connect schema and form are on TanStack Form (J5 to J7)

**Date & time:** 2026-10-26 22:09

`connect-schema.ts` is one `z.discriminatedUnion('mode', …)` over the form's values, with a message for each field, a refinement that `verify-full` needs a CA file, one that a connection string names a database, and a transform to `{ params, remember }`. It also has the SSL helpers (`defaultSslMode`, `effectiveSslMode`) and `takeSslMode`, which lifts a pasted string's `sslmode` out of the text. The form is `useForm` with `validators: { onSubmit: connectSchema }`; its submit handler parses the values with the schema again to get the transformed parameters (TanStack passes the raw values) and calls `connection.open`. A failure is set with `setErrorMap({ onSubmit: { form: message, fields: {} } })`: the form then holds the message as a plain string in `state.errors` (schema failures are objects keyed by field, so the screen reads only the strings), and it clears on the next edit. Fields use `FormTextField` (shadcn `Field`, `FieldLabel`, input or `PasswordInput`, `FieldError`), which shows the schema's message once the field is touched and invalid; a submit touches every field. Two field listeners do the reactions: the mode field's `onChange` fills the socket directory and operating system user and clears the password when it becomes `socket`, and the URL field's `onChange` moves `sslmode` into the selector. The SSL selector keeps `null` until a mode is picked and shows `effectiveSslMode` of the form's values, so it follows the host without a listener. `use-connect-screen.ts` now builds the form, loads the defaults and recent connections, and opens a recent one (reporting its failure on the form); the old `connect-form.ts`, its tests, `TextField` and its tests are gone, their cases moved to the schema, `FormTextField` and Connect tests.

**Rationale:** as agreed in the plan change above. A password left empty is still sent as no password and the server's own message is shown for a missing one, so no error-table row was added. J7 changed four source files and deleted two, as the plan says it would; the old and new forms couldn't both drive the same fields.

## schema.load reads the open database on the main connection (K1)

**Date & time:** 2026-10-28 17:34

`loadSchema(connection)` runs core's `introspect` inside `connection.exclusive`, so the snapshot (`BEGIN … COMMIT`) is the connection's own while it runs and a statement from elsewhere waits behind it. The `schema.load` handler (`main/ipc/schema.ts`, registered in the domain list) takes no input, uses the session's open connection, and throws "No database is open" when there is none; any other failure also rejects, and the renderer is the one that marks the session stale. `schema.fingerprint` and `schema.casts` stay unbuilt until the poller and the SQL generation need them. Tests: a DB test loads core's `basic.sql` fixture (tables, cast data, a fingerprint that is the same twice and changes after a `CREATE TABLE`, the exclusive section, and a copy through `structuredClone`, which is what IPC does), and an e2e test opens the fixture through the real app and checks the model, the enum, the view and the read-only partial index.

**Rationale:** the plan has the introspector return `{ model, casts, fingerprint }` from one snapshot, which core already does; the service only has to keep the connection to itself. The fixture is read from core's test folder so the app and core start from the same schema. In that fixture the unmodeled objects include the sequences behind identity and serial columns, not only the view.

## The schema store (K2)

**Date & time:** 2026-10-28 17:34

`renderer/src/stores/schema/` is a Zustand store in slices: `core.ts` (`baseline`, `desired`, `casts`, `loadedFingerprint`, `stale`, `version`, `load`, `markStale`, `edit`) and `tables.ts` (`addTable`, `renameTable`, `removeTable`, `restoreTable`), put together in `index.ts`, which also gives `createSchemaStore()` (a store of its own, for tests) and the app's `schemaStore` and `useSchemaStore`. `edit(change)` changes a copy of `desired` (`structuredClone`) and bumps `version`, so every model the store has handed out stays as it was; this is marked with a `shortcut:` comment (copying the whole model on each edit). A new table is a random-UUID table in the schema with an `id bigint` identity `ALWAYS` primary key (an auto-named, empty-named `pk` constraint; names are given by `assignNames` when the diff is worked out), and is called `new_table`, `new_table_2`, … within its schema. Removing a table takes its columns, constraints and indexes and the foreign keys of other tables that point at it, and returns `null`, or a message when something read-only depends on it (core's `blockersOfTable`, now exported along with `blockersOfColumn`, so the action and the diff's guard give the same answer): `Can't delete table "invoices": view "open_invoices" still depends on it`. Restoring copies the table and everything of it from `baseline`; foreign keys come back once the tables at both ends are there, so two tables that point at each other are restored in either order. A pending table is removed for good; restoring it does nothing.

**Rationale:** this is the plan's "Editor state" section. A foreign key that was removed on its own before its table was removed comes back with the table: the store doesn't track why something was removed (a shortcut to revisit if that matters). `renderPgType` is now exported from core for the status map.

## Derived diff and status map (K3)

**Date & time:** 2026-10-28 17:34

`derive(baseline, desired)` (`stores/derived.ts`) gives `named` (`assignNames` of `desired`), `ops`, `errors` (validation plus the diff's own), `risks` (each `Risk` with the operation it belongs to) and `statuses`; `derived()` remembers the result per pair of models in nested WeakMaps (an edit makes a new `desired`, a load a new `baseline`), so it runs once per edit however many components ask, and two stores never share a result; `useDerived()` is the hook. `statusMapOf(ops, baseline)` (`canvas/status.ts`) gives each changed object `added`, `modified` or `removed` and, for modified ones, only the fields that changed with their old values (`name`, `type`, `notNull`, `default`, `comment`), taken from `baseline`. A dropped table's columns, keys and indexes are marked removed too, since they have no operation; an object that is dropped and added again (a key whose columns changed) is one modified object; added wins over modified.

**Rationale:** as the plan's "Derived diff" bullet describes it. A blocked removal (a view on the column) leaves the diff without the drop and an error instead, so the status of such an object stays unchanged and the error says why.

## Column actions and their coupling rules (K4)

**Date & time:** 2026-10-28 21:23

`stores/schema/columns.ts` adds `addColumn` (a nullable `text` column at the end of the table, `new_column`, `new_column_2`, …), `renameColumn`, `setColumnType`, `setNotNull`, `setPrimaryKey`, `setColumnDefault`, `setColumnComment`, `removeColumn` and `restoreColumn`. The coupling rules are in the actions: `setPrimaryKey(id, true)` puts the column in the table's primary key (making one if there is none) and turns NOT NULL on; `false` takes it out and leaves NOT NULL on, removing the key when no column is left; neither touches the type or adds identity. `setNotNull(id, false)` is refused for a column in the primary key and for an identity column; `setColumnDefault` refuses a default on an identity column; `setColumnType` keeps an identity column to `smallint`, `integer` or `bigint` (plain, not an array). A refused action returns the reason as a string and changes nothing; one that was done returns `null`. An action on a column that isn't there does nothing, not even bump the version. A column joining an existing primary key changes it, so the diff drops and adds the key; a foreign key that relied on the old key is then reported by validation or rebuilt by the diff, as before. `helpers.ts` has `firstFree` (the unique default names, now also used by tables) and `nextPosition`.

**Rationale:** the plan's "Editor state" section. The primary key toggle is a column action because the coupling is about the column; unique, foreign key and index actions are constraints (K5). K4 changed four files (`columns.ts`, `helpers.ts`, `tables.ts`, `index.ts`) because the shared naming helper replaced a copy in `tables.ts`.

## Constraint, index and schema actions (K5, K6)

**Date & time:** 2026-10-28 21:23

`constraints.ts`: `setUnique` (adds or removes the unique constraint on just that column; composite ones are left alone), `addForeignKey` (any two tables, self-references included, `NO ACTION` both ways), `setForeignKeyActions`, `addCheck` (the expression and columns come from the normalizer), `renameConstraint`, `removeConstraint` and `restoreConstraint`. `indexes.ts` (a separate file, so neither grows long): `addIndex`, `updateIndex` (columns and unique), `renameIndex`, `removeIndex`, `restoreIndex`. `schemas.ts`: `addSchema` (`new_schema`, `new_schema_2`, …) and `setTableSchema`, which moves a table the migration creates and refuses one that is in the database, saying why. New constraints and indexes are auto-named with an empty name and `autoName: true`; naming one yourself sets `autoName: false`, so a pending one stops following its table and columns. Restoring a constraint or index copies it from the loaded schema and does nothing until the table and columns it is built on are there. A foreign key that points at a column or table is created without checking that a key covers it: validation reports that, as the plan says.

**Rationale:** the plan's K5 and K6 rows; the extra `indexes.ts` is the one file beyond them.

## Cascade on column removal (K7)

**Date & time:** 2026-10-28 21:23

`removeColumn` removes the column and, with it, every constraint and index that lists it (read-only ones on its table too, such as a partial index or an exclusion constraint) and every foreign key on any table that points at it. It first asks core's `blockersOfColumn` and refuses, naming them, when a view, policy, trigger or function uses the column or a read-only foreign key on another table points at it (`Can't delete column "total": view "open_invoices" still depends on it`); a partial index on the column does not block, and its drop is listed as destructive. `restoreColumn` copies the column back and, from the loaded schema, each of those that is connected again, so a foreign key whose table is still removed waits and comes back with the table. The functions are in `cascade.ts`, shared with the constraint and index restores. Removing a pending column removes the pending constraints and indexes built on it for good. A constraint that lists the column is removed whole, so removing one column of a composite primary key removes the key, as for a composite unique constraint.

**Rationale:** the plan's cascade rule and its K7 test (a composite unique, a multi-column check and a foreign key from another table go with the column, the diff drops them before it, and nothing blocks generating). `cascade.ts` is a separate file for the pure functions so the same code serves the column actions and the tests.

## The canvas, and the Editor loads the schema (L1, L2)

**Date & time:** 2026-10-28 21:33

The Editor (`screens/Editor/`, a folder now, with `use-load-schema.ts`) asks `schema.load` once when it opens and puts the result in the schema store; until then it says "Loading the schema…", and if the call fails it shows "Couldn't load the schema: <message>" and still has Disconnect. Above the canvas is a slim bar with the old placeholder's content (the heading, which database is open, the "password not saved" notice, Disconnect) until the top bar of phase O1 replaces it. `api.schema.load()` is added to the renderer's client. `Canvas` (`canvas/Canvas.tsx`) is a React Flow canvas with a background and zoom controls, fed by `unionOf(baseline, desired)` (`canvas/model-view.ts`): the edited object where there is one, otherwise the loaded one, so a table the user removed stays on the canvas and a new one appears; one node per table. Nodes are not draggable or connectable yet, and sit on a plain grid in table order (marked with a `shortcut:` comment: auto-layout is L4 and saved positions L6). `tableViews` turns the model into what a node shows; `TableNode` is `schema.table` over one `ColumnRow` per column in table order. A row shows the name, the type as people write it (no quotes, no `public.`), badges for PK, NN and UQ (UQ only for a column that is alone in a unique constraint; a unique index doesn't count), the default as a `= …` chip, and a `→ table.column` chip for each foreign key it is in, with the schema in front when it is another schema's table; a composite foreign key points each column at its own target. The badge and chips are shadcn `Badge`. The jsdom tests need `DOMMatrixReadOnly` stubbed, and look nodes up with `hidden: true` because React Flow keeps a node hidden until the browser has measured it; the e2e test checks they are visible.

**Rationale:** the plan's canvas section: the union of baseline and desired is what lets removed objects stay restorable. L1 changed more than three files (`Canvas.tsx`, the Editor folder and its hook, `model-view.ts`, `api.ts`) because the union and the loading both had to exist for a node to appear; the node and row are L2. The Canvas test, the Editor test and the node and row tests run in jsdom; the e2e test (`editor.spec.ts`) opens the `basic.sql` fixture through the real form and counts the nodes.

## Foreign key lines (L3)

**Date & time:** 2026-10-28 22:02

Every row has four handles (left and right, each as a start and an end of a line, with ids `<column>:<side>-<role>`), so a line can leave or arrive on either side without handles being added later. `foreignKeyEdges(model, positions)` (`canvas/edges.ts`) gives one edge for each foreign key in the union of the loaded and the edited schema, from its first column to the first column it points at (a composite key is one line, not one per column pair); a key whose table or column isn't in the model is skipped. A line leaves the side of its table that faces the other: right to left when the table with the key is to the left, the other way round when it is to the right (the `x` of the table positions decides, so the lines follow the layout). A foreign key to its own table leaves and returns on the right and is drawn by `loopPath`, a curve whose control points are 60 px out to the right of both ends: the ordinary curve between two points at the same `x` has no bulge and ran along the table's edge, which the first e2e run showed. `FkEdge` draws a line with a crow's foot at its start (the table with the key: many rows may point at one) and a double bar at its end (one), as SVG markers (`FkMarkers`, defined once with the theme's muted colour); the edge element carries `data-self-reference`.

**Rationale:** the plan's "FK edges are custom SVG edges with crow's-foot markers; a self-referencing foreign key draws as a loop on the node's side". Handles are not connectable yet: drawing a key by dragging between handles is a later phase.

## Auto-layout (L4)

**Date & time:** 2026-10-28 22:02

`autoLayout(tables, links)` (`layout/autoLayout.ts`) builds an ELK graph with a node per table and, for each foreign key, a port on the row it starts from (east side) and one on the row it ends at (west side), fixed in place so the layout takes the rows into account; it uses the layered algorithm running left to right, so a table with a key sits to the left of the table it points at. `toElkGraph` is exported and tested apart from the layout. The layout runs in a worker (`layout/elk.worker.ts` is ELK's own worker script, `elkjs/lib/elk-worker.min.js`), driven by ELK's API class, which is created when it is first needed; the bundled single-thread build of ELK can't be used in the app, since it looks for a `Worker` it can't find once bundled (the first e2e run failed with `_Worker is not a constructor`). `layout/` takes a `LayoutRunner` so tests run the real layout in the same thread. `useAutoLayout` gives the Canvas positions for the tables that have none: it lays out the whole graph and only the new tables take their place, so one already placed stays; until it answers (and if it fails) tables stay on the plain grid, and the canvas root says `data-layout` = `pending`, `ready` or `failed`. The view is fitted once when the layout first finishes. Positions are still kept in the Canvas's own state, marked with a `shortcut:` comment; the layout store (L6) will keep and restore them.

Tables are now drawn at exactly the size the layout assumes: 300 px wide, a 40 px header, rows of 28 px and 4 px padding, with long names, types and chips cut short (the chips show the full text as a tooltip). Before that the layout assumed 300 px while a long default chip made a node much wider, and the e2e overlap check found two tables on top of each other. The constants are exported from `autoLayout.ts` and used by the node, so they can't drift apart; a component test adds them up.

**Rationale:** the plan has ELK in a worker with one port per column. Using fixed sizes avoids drawing nodes, measuring them and laying out again. The e2e checks that the layout is ready (so the worker works under the page's content security policy), that no two tables overlap, that a table sits left of the one its key points at, and that there is one line per key, each with the markers, one of them a loop reaching beyond its table's right edge.

## Saved layouts: repository and channels (L5)

**Date & time:** 2026-10-28 22:50

Positions live in the app database's `layouts(db_key, object_id, x, y)` table, behind `createLayoutsRepo` (`main/store/layouts.ts`): `get`, `put` (replaces every position of a database in one transaction, rolled back on error), `prune` and `removeForConnection`. Two channels: `layout.get` takes `{ dbKey, tableIds }`, deletes the rows of any table not in `tableIds` and returns what is left; `layout.put` takes `{ dbKey, positions }` and replaces. `connection.forget` now also deletes the layouts of that connection (every `dbKey` that starts with `<id>:`, with `%`, `_` and `\` in the id escaped for `LIKE`).

**Rationale:** the plan has pruning happen on load. Doing it inside `layout.get` (the renderer says which tables exist) keeps the renderer from needing a separate cleanup call and means a table dropped in the database never leaves a row behind. Replace-on-put keeps the repository free of per-table updates.

## Layout store with debounced save (L6)

**Date & time:** 2026-10-28 22:50

`stores/layout.ts` (`createLayoutStore`, with `layoutStore` for the app) holds `positions` for the open database and whether they have `loaded`. `restore(dbKey, tableIds)` runs once the schema is loaded (in `useLoadSchema`); a failed read is treated as no saved layout, so the Canvas lays everything out afresh. `move` (dragging) and `place` (auto-layout) change positions and save 500 ms after the last change; `flush` saves at once and runs when the Editor closes and before another database is restored. A failed save is tried again with the next change or flush. Auto-layout now waits until the positions are loaded and only places tables that have none, so a saved layout is never rearranged; the canvas root stays `pending` until then. Nodes are draggable. A table that has a position but is still pending (new) is saved too and removed by the prune on the next load, since its id changes when it is created.

**Rationale:** the debounce keeps a drag from writing on every mouse move; flushing on unmount avoids losing the last move when the user disconnects within the delay. The e2e test moves a table, waits for the save, restarts the app on the same data folder and checks the node is in the same place in canvas coordinates (its place on screen depends on the zoom the view is fitted to).

## Compact nodes (L7)

**Date & time:** 2026-10-28 22:50

Below 70% zoom (`COMPACT_ZOOM`) a table is drawn by `CompactNode`: the name and the number of columns, at the same width and header height as the full node, with no rows. All of a table's handles are still rendered (hidden), so foreign key lines keep their ends. Clicking a compact node zooms to it with `fitView` (at most 100%), which brings the full node back. `Canvas` is wrapped in a `ReactFlowProvider` so it can read the zoom from the store and call `fitView`. The compact node is shorter than the full one the layout assumed; the gap was accepted rather than laying out again on every zoom change.

**Rationale:** the plan asks for compact nodes at low zoom to keep a large schema readable. The fit on load for the three-table fixture lands at 0.69 in a 900 px window, so the first view can already be compact; the e2e tests zoom with the controls until they are on the side they need.

## Status styling (L8)

**Date & time:** 2026-10-29 10:20

Each table and column of a view carries a `state` (`canvas/object-state.ts`): its diff status (`added`, `modified`, `removed`, from `statusMapOf`), the first validation error on it, and its read-only reason. `tableViews(model, { statuses, errors })` fills it in from the derived diff, which `Canvas` takes from `useDerived()`; without those it is empty, so the views can still be made from a model alone. `stateClasses` gives the look: added is a green left edge and tint, modified amber, removed a red edge and tint with the text struck through and faded, an error a red outline, read-only grey with a lock icon (`LockIcon`, labelled "Read-only"). `stateTitle` gives the hover text: the error message, `Read-only: <reason>` (`READ_ONLY_LABELS` turns each core reason into words), and `Was: type varchar(100)` for what a modified object used to be, from the old values the status map already keeps. The table node and the column row set `data-status` and `aria-invalid` besides, so the tests and the accessibility tree can see them. The status colours are CSS variables in `main.css` (`--added`, `--modified`, and three opaque tints mixed into the card colour, opaque so a foreign key line under a node doesn't show through).

An error is only shown on the table or column it belongs to; errors on constraints and indexes get their place with the footer (M17), and the clickable restore of a removed object comes with the editing phases.

**Rationale:** the plan's diff highlighting table. Putting the state in the view keeps `TableNode` and `ColumnRow` free of store access, so their component tests pass a state in and check the style it gives. The Canvas test edits the real store and checks the rows follow.

## Schema filter and stubs (L9)

**Date & time:** 2026-10-29 10:20

`stores/ui.ts` (the plan's UI store; only the filter is in it so far) keeps `hiddenSchemas`, the ids of the schemas to hide, so a schema that appears later is shown. `chrome/SchemaFilter.tsx` is a shadcn `DropdownMenu` (added with the CLI) with a checkbox item for each schema of the loaded and edited schemas together, which stays open when one is toggled, and "Show all"; its button says how many are shown (`Schemas (1/2)`). Until the top bar (O1) it sits in the Editor's slim bar. `Canvas` leaves out the tables of hidden schemas from the nodes but still lays all of them out, so showing a schema again puts its tables back where they were and never rearranges the rest.

A foreign key from a drawn table to a hidden one ends in a stub: `foreignKeyStubs` (`canvas/edges.ts`) gives a small dashed node (`StubNode`) to the right of the table, level with the key's row and named `→ schema.table`, and a line to it; it can't be dragged or selected, and follows its table. A key the other way round, from a hidden table to a drawn one, has no line and no stub. `foreignKeyEdges` takes the set of drawn tables, and both functions share `endsOf`, which finds the first pair of columns of a key.

**Rationale:** the plan says "FK edges to hidden tables end in a small stub labeled with the target table". Stubs are ordinary React Flow nodes so the existing edge and handle code draws the line to them, instead of a second kind of edge that has no target node. Nothing is drawn for a hidden table's own keys because there is no row to draw them from; the hidden table's schema is one click away in the filter.

## Inline name editing (M1)

**Date & time:** 2026-10-29 12:05

`editors/InlineText.tsx` shows a name as a text button; clicking it turns it into a shadcn `Input` with all the text selected. Enter, Tab or the input losing focus commits, Esc cancels. Text that is empty (after trimming) or unchanged commits nothing, so it never makes a change. A commit calls `renameTable` or `renameColumn` on the schema store; the name is not checked here, since a name that is taken or empty is a validation error shown by L8. The table name in the header and the column name in a row use it. A read-only object and one that is being removed show a plain name with nothing to click (`isEditable` in `object-state.ts`); compact nodes have none, since clicking one zooms to it.

The plan says "Click → inline input" in the interaction table and "double-click the name" in the node section: the table wins, so it is a single click for tables and columns alike. The UI store now holds `editing`, the key of the one input that's open (`<id>:name`), as the plan's UI store lists "the cell being edited"; opening a second input commits the first, as its input loses focus, and `stopEditing(key)` does nothing if another has opened since. The change handler (phase P) can wait on it.

Leaving the input commits instead of discarding because the plan says typed text is never lost. Tab commits on its own key as well as on the blur that follows, so a `finished` flag keeps it from committing twice.

The e2e test needs the change count: until the top bar (O1) there is a small `ChangeCount` (`chrome/ChangeCount.tsx`) in the Editor's bar saying "N changes", from the number of operations in the derived diff. O1 replaces it with its own counters.

**Rationale:** the plan's M1 test, "rename a column; it turns amber and the change count updates". The e2e test brings a table into view by clicking its compact node (`showTable`), since zooming in with the controls can push a table off screen where Playwright can't reach it.

## Input safety (M2)

**Date & time:** 2026-10-29 12:05

The input carries `nodrag nopan` (React Flow's classes), so selecting its text with the mouse doesn't move the table or pan the canvas, and the name button and the PK/NN/UQ buttons carry `nodrag` so dragging from them moves the table instead of starting nothing. React Flow already ignores key presses that come from an input; on top of that `Canvas` sets `deleteKeyCode={null}`, so Backspace and Delete never delete a node, whether or not an input has focus. The canvas ignores node removal changes anyway; a table is deleted from its toolbar (a later phase).

**Rationale:** the plan's rule, "Delete/Backspace never remove nodes while an input has focus". Turning the key off outright is safer than relying on focus checks and costs nothing, since the key was never meant to do anything. The e2e test selects text by dragging, checks the table hasn't moved, presses Backspace in the input (it edits the text) and with the table selected (it stays).

## PK, NN and UQ switches (M3)

**Date & time:** 2026-10-29 12:05

`KeyBadges` renders the three badges on every column as buttons with `aria-pressed`, faded when off. PK calls `setPrimaryKey` (which turns NOT NULL on and leaves it on when PK is turned off), NN `setNotNull`, UQ `setUnique`. NN is disabled while the column is in the primary key or is an identity column, with the reason as its hover text; all three are disabled on a read-only column and on one being removed. `ColumnView` now has `identity`. The badges used to appear only when on; they now always show, so a row has less room for a long name or default (both are cut short as before).

**Rationale:** the plan's M3. Locking NN instead of showing the store's refusal message means the message can't happen from the UI. The component test runs the real store: PK on a nullable column turns NN on and locks it; PK off leaves NN on and unlocks it. The e2e test does the same on the fixture and checks an identity column's NN is disabled.

## Fixes found while trying M1–M3 by hand

**Date & time:** 2026-10-29 13:10

Three things showed up when the app was tried by hand.

**Column names were squeezed out of their row.** With PK, NN and UQ always shown (M3) plus the type and the chips, the name and type were cut to a letter or nothing. `ColumnRow` now gives the name `max-w-28 shrink-0`, lets the type and the default and foreign key chips shrink (the chips first, `shrink-3`, and cut with an ellipsis; the full text is in their hover), and the lock and the switches never shrink; the switches are a little narrower (`px-1.5`). The e2e test checks no name is cut. The row is still 300 px wide, so a long default or target is cut short.

**Turning UQ (or PK) on or off didn't change how the row looked.** The diff gave the new constraint a status, not the column, and a column's PK and UQ badges are drawn from those constraints. `statusMapOf` now marks a column modified, with `old: { unique: false }` or `{ primaryKey: true }` and so on, when a primary key it is in, or a unique constraint on just that column, is added or dropped (`Was: not unique`). A column that is in a key that is dropped and made again with it still in (widening a key) isn't marked. A unique constraint on several columns isn't a UQ badge, so it marks nothing.

**The e2e suite was flaky under load**, failing now and then on the layout or the nodes not being ready within 5 s while two apps and the container ran together. Playwright's `expect` timeout is now 10 s (`playwright.config.ts`); the test timeout is as before.

## Type picker (M4)

**Date & time:** 2026-10-29 15:40

`editors/TypePicker/` is the type of a column as a button that opens a shadcn `Popover` with a `Command` (cmdk, added with the CLI along with `popover`): a search box over the built-in types and the database's enums. The built-in list (`types.ts`) uses the names the model uses (`format_type`'s short names: `integer`, `bigint`, `varchar`, `timestamptz`…) and says which have parameters: `varchar` and `bpchar` a length, `numeric` a precision and a scale, `timestamp`, `timestamptz`, `time` and `timetz` a precision. Choosing a type changes the column at once; a type without parameters closes the popover, one with them stays open and shows a number input for each, and an empty input means none (a scale with no precision is dropped, since it means nothing). The array switch is a checkbox. Enums come from the loaded schema (`use-enum-types.ts`; they can't be edited in 0.1.0), listed as `schema.name`; domains and other user types are not offered.

If the store refuses the change (an identity column has to stay an integer) the popover stays open and says why, and the column keeps its type. A read-only column or one being removed shows its type as plain text. `ColumnView` has `pgType` (the type itself) and `tableId` besides its `type` label.

**Rationale:** the plan's type picker. Applying each change as it is made means there is no apply button, and the diff, the amber row and the change count follow while the popover is open.

## Adding and deleting columns, and the keyboard (M5)

**Date & time:** 2026-10-29 15:40

Enter on the name of the last column of a table commits it and goes on to a new column with its name ready to type (`addColumnAndEdit`); typing a name and Enter makes the next one. Esc on a column that was made that way and not yet named takes it away again (the UI store's `addedColumn`, cleared whenever an edit ends), so a run of Enters ends with Esc and no stray `new_column`. Esc on any other name only cancels the edit. A `⋯` at the end of each row, shown when the row is hovered or has focus, deletes the column, or, for one that is being removed, restores it (the plan says "click to restore"; this is that click). A read-only column has no menu. If something depends on the column (a view, a read-only foreign key elsewhere) the store refuses and the reason is shown as a notice under the bar (`ui.notice`, with Dismiss), which the table toolbar uses too.

`InlineText` changed with this: Enter and Esc give focus back to the name (a moment later, so that Enter's own key press doesn't land on the button and open it again), Tab commits and leaves the input where the browser would have taken it, and the input is focused from an effect that tries again for a few frames, because React Flow keeps a table hidden for an instant after its content changes and a hidden input can't take focus (`autoFocus` lost it every time a column was added). The plan's Tab order, name → type → next row, is the page's own order here: the PK, NN and UQ switches are tab stops between the type and the next row, so they stay reachable with the keyboard.

**Rationale:** the plan's M5 ("Enter on last row adds a column") and its e2e test, three columns with the keyboard alone. The Esc rule is mine, so that the keyboard flow doesn't leave an extra column behind.

## New tables and the table toolbar (M6)

**Date & time:** 2026-10-29 15:40

A double-click on the empty canvas makes a table with its top left corner at the cursor and its name ready to type (`createTableAt`). It does nothing on a table, and when the tables are compact (they can't be edited at that zoom). React Flow's own double-click zoom is off. The schema is `newTableSchema`: the one schema the filter leaves showing, otherwise `public` if it is shown, otherwise the first by name. The new table has the identity key column the store gives it, and its position is saved like any other (and dropped on the next load, since its id changes once it exists).

`TableToolbar` is React Flow's `NodeToolbar` above the table while it is hovered or selected, with Add column (as the Enter flow: the new name is ready) and Delete table, whose refusal is shown as the notice; a removed table has only Restore table, and a read-only one has no toolbar. Add index, add check and comment come with their own phases. In the tests `NodeToolbar` is replaced by a pass-through, as jsdom has no measured node to put it next to.

**Rationale:** the plan's M6. The e2e test finds a point of empty canvas on the page and checks the new table's corner is there.

## The e2e suite is still flaky

**Date & time:** 2026-10-29 15:40

Across about a dozen full runs, some pass whole (26 of 26) and others lose one to six tests that wait for the Editor or a connection message and time out at 10 s, always on code unrelated to what changed (the connect screen's wrong password test fails too). Thirty app launches in a row in one test all got the Editor in under a second, and one with a single worker fails in clusters too, so it looks like the machine or Docker stalling now and then, not a race in the app; it has not been found. Every new test passes on its own and in the runs where the suite is whole.

## Closing the type picker, and a safe strip above the table (M4, M6 follow-up)

**Date & time:** 2026-10-29 16:20

**The type picker stayed open when the empty canvas was clicked.** The click reached the page but the popover didn't close for it (it did for a click on the bar above the canvas; React Flow's pane is the odd one out). The picker's open state is now the UI store's `editing` (key `<column id>:type`), the "open popover" the plan lists there, instead of its own state, and `Canvas` ends any open edit on a pane click (`cancelEditing`). One side effect: opening the picker ends an inline name edit that is open, which commits it first as its input loses focus.

**The toolbar went away on the way up to it.** The toolbar floats 4 px above the table, and for an instant the pointer was over neither. `TableNode` is now a wrapper `div` that holds the hover, with the table and, while the toolbar is shown, an invisible strip above the table's top edge (`h-14`, 56 px, widened by hand from the first `h-5`), which covers the gap and the toolbar. It is outside the table box (the table clips its content) but inside the wrapper, so the pointer over it counts as over the table. The e2e test moves the pointer from the header to the toolbar 40 steps and checks the toolbar is visible at each; without the strip it fails. A double-click on the strip above a hovered or selected table no longer reaches the canvas, so it doesn't make a table there.

## Schema picker for new tables (M7)

**Date & time:** 2026-10-29 19:10

For a table the migration creates, the schema before the dot in the header is a menu (`editors/SchemaPicker.tsx`, a shadcn `DropdownMenu`): the schemas as radio items, the current one ticked, and "New schema…". That makes a pending schema, moves the table into it and opens its name to type, in its row of the menu, which stays open. A table that is in the database shows its schema as plain text, as before. `TableView` has `schemaId`.

Both this menu and the Schemas filter put a pen and a trash can at the end of the row of each schema the migration creates (`editors/SchemaRowActions.tsx`; a schema in the database has neither, since renaming and dropping those waits for 0.2). The pen turns the name into an input in the row (the existing `InlineText`); the trash can deletes the schema, or, if a table is in it, says so in the notice bar and deletes nothing. Neither icon also chooses or ticks the row. The store has `renameSchema` and `removeSchema`, both for schemas the migration creates only; deleting also removes it from the diff, so the migration no longer creates it. Both menus take their list of schemas from `hooks/use-schemas.ts`.

While a name is being typed in a menu, the input is not a menu item, its keys don't reach the menu (no typeahead, no Enter or Space choosing an item), and the other items stop the menu from moving the focus: a Radix menu focuses the item under the pointer, and the menu itself when the pointer leaves an item, which took the focus from the input (the e2e test showed it) until the items were given a handler that prevents it (`whileRenaming`). Esc in the input gives up the rename and, as it is Esc, closes the menu too.

**Rationale:** the plan's M7 says "New schema…" creates a pending schema, and says nothing about naming it. A schema that could only be called `new_schema` would be of little use, so the name opens as soon as it is made.

## Removed objects and their foreign keys (M8)

**Date & time:** 2026-10-29 19:10

A foreign key the change drops is drawn red, dashed and faded (`FkEdge`, from `data.removed`, which `foreignKeyEdges` sets from the set of removed ids that `Canvas` takes from the status map). Deleting a table marks the keys it has, and the keys other tables have to it, as removed, since the diff drops both; restoring the table brings both back. A click on a removed column's row brings it back; a click on the header of a removed table brings the table back, and so does a click on a row of a removed table, since a column can't be there without its table. The `⋯` menu's "Restore column" does the same for the keyboard; the menu stops the click so the row doesn't restore it a second time. The hover text of a removed object says "click to restore".

A removed foreign key can't be restored on its own by clicking its line: that comes with the foreign key popover (M12).

**Rationale:** the plan's "Removed: red, struck through, faded; click to restore" and its M8 test, deleting a referenced table. The e2e test deletes `users` from the fixture and expects two removed lines (its own to itself and invoices' key to it), the third staying, and none after a restore.

## Normalizer service and `expr.normalize` (M9)

**Date & time:** 2026-10-29 19:10

`services/normalizer.ts` (`createNormalizer`) answers `expr.normalize` requests on one task connection, opened by the first request and kept for the next, and closed after 30 s with none (`IDLE_MS`; a request in progress holds it open, and a request restarts the 30 s). Requests queue on the connection (`exclusive`), and `normalizeExpression` from core runs each in its own `BEGIN … ROLLBACK` on a temporary copy of the table, so it needs no transaction from the task connection (which would nest). A connection that fails to open is not kept, and one that breaks (`onLost`) is dropped, so the next request opens a new one. The normalizer is part of the open session (`ActiveSession.normalizer`): it is made when a database is opened, and closed when the session is replaced, closed or lost. `IpcDeps` has `openTask` (the way task connections are opened) for tests. `ipc/expr.ts` is the channel: it needs an open database, and the input is checked by the contract's schema before anything runs.

The answer is core's: `normalized` with the text (and, for a check, the columns it uses in the order Postgres stores them), `invalid` with Postgres' own message, or `raw` with the text as typed when the role can't create temporary tables or the session is read-only. Core now exports `quoteIdent` and `quoteLiteral` (the DB test needed them).

**Rationale:** the plan's "one reused task connection per window (closed after 30 s idle)". Tying it to the session means Disconnect closes it at once instead of leaving a connection for 30 s. The DB test (Postgres 14, 16 and 18) covers a default, a check's columns, an error, six requests at once on one connection, the idle close and a role without TEMP; unit tests cover the sharing, queueing, timer and failure cases; an e2e test calls the channel through the preload bridge and sees two backends.

## Errors are shown as toasts

**Date & time:** 2026-10-29 21:30

Everything the app tells the user went wrong is an error toast from `sonner` (the shadcn `Sonner` component, with its `Toaster` in `main.tsx`), instead of a banner or text in the page. What was changed:

- **Refusals of an edit** (a column or table something depends on, a schema with a table in it, a table that can't move, a schema in the database): the store actions return the reason, and `showRefusal` (`lib/refusal.ts`) shows it. The message is the toast's id, so the same refusal again shows one toast, not a pile. The `notice` in the UI store and its bar under the top bar are gone.
- **A type the store refuses** (an identity column that has to stay an integer): a toast; the picker stays open and the column keeps its type. The red text inside the popover is gone.
- **A schema that can't be loaded**: a toast that stays (`id: 'load-failed'`, no time limit) until the Editor goes, which dismisses it. The red banner in the Editor is gone; Disconnect is still in the bar.
- **A connection that fails to open** (and a saved one that fails): a toast with the message. The red alert in the Connect form is gone, and so is the form error it was kept in; the form is no longer marked invalid by a server failure, so it can be tried again straight away.

What stays as it was: the messages under a field while it is filled in (the form's validation, like "Enter a host"), which belong to the field; the red outline and hover text of a table or column with a validation error, which the plan puts on the node (M17); and the note that the password was not saved, which is a notice and not an error.

**Rationale:** one place and one look for everything that goes wrong. A toast also stays out of the way of the canvas, unlike the bar that moved it down.

## Toast colours

**Date & time:** 2026-10-30 09:40

The Toaster (`components/ui/sonner.tsx`) has `richColors` on, and each kind takes its colours from the ones the diff highlighting already uses in `main.css`: error is the red tint with `--destructive`, success the green tint with `--added`, warning the amber tint with `--modified`. The text is darkened by mixing it with `--foreground` (45–75 %), since the plain amber and green read poorly on their own tint. Info and the plain toast keep the popover colours, as asked. No colour is written in the component; they are all variables.

**Rationale:** one set of colours for "added", "modified" and "removed" everywhere, so a red toast and a removed row are the same red. Checked by screenshots of each kind in the built app.

## Expression input with live normalization (M10)

**Date & time:** 2026-10-30 13:30

`editors/ExpressionInput` is an input for a SQL expression (a default now, a check later). Its hook asks `expr.normalize` 400 ms after the last key, and shows Postgres' own error under the input, and, when the canonical text is not what was typed, "Stored as …". It hands each answer (a cached one too) to `onAnswer`. An empty input asks nothing. A request that fails (no database open) says "Couldn't check the expression: …" and is asked again the next time. The renderer's `api` has `expr.normalize`.

Answers are cached by request in `normalize-cache.ts` (`normalize` for anything that needs one, `cachedAnswer` to look): the key is the fingerprint of the loaded schema, the expression, what it is for and every column of the table, so another table or column is another request, and nothing outlives a reload of the database. A request in flight is shared, so the same thing asked twice at once is asked once; a failed one is not remembered. The first `raw` answer (a role that can't create temporary tables) sets `normalizationFallback` in the UI store, for the check editor to read (M14), and shows one warning toast that stays.

**Rationale:** the plan's M10 test: errors inline, one request 400 ms after typing stops, cached results not asked again. Errors of an expression are inline because they belong to the input, as the form's field errors do.

## Default popover (M11)

**Date & time:** 2026-10-30 13:30

The default of a column is a chip (`editors/DefaultPopover/`) that opens a popover with three tabs: presets for the type (`presets.ts`: `0` for numbers, `false` and `true`, `''` for text, `gen_random_uuid()`, `now()` for timestamps, `CURRENT_DATE`, `LOCALTIME`/`CURRENT_TIME`, `'{}'` and `'[]'` for json, `'{}'` for any array, and the labels of an enum), a constant (quoted for any type but numbers and booleans) and any expression (typed in an `ExpressionInput`; Set default is on once Postgres has read it). Whatever is chosen goes through the same normalizer, so it is stored the way Postgres reads it back (`'banned'::public.user_status`) and a default put back as it was is not a change (the e2e test takes `now()` off `created_at` and puts it back, and the count is 0). Postgres rejecting it is said in the popover and nothing is set. "Remove default" clears it. A column with no default shows a faint "+ default" chip while its row is hovered or has focus; an identity column shows nothing, since it can't have one, and a read-only column shows its default as plain text.

The chip's open state is the UI store's `editing` (`<column id>:default`), like the type picker, so a click on the empty canvas closes it. Because a chip is now something to click, the node is wider (360 px, was 300) and a default keeps at least 3.5 rem for itself, with the type giving way first; before that a row with a long type left the chip 18 px wide.

**Rationale:** the plan's M11. Presets are the ones that make sense for the type; there is no list for types such as `inet`, which take a constant or an expression.

## Foreign keys by dragging, and their popover (M12)

**Date & time:** 2026-10-30 13:30

A line can be dragged from the edge of one row to the edge of another, in any table, including the same one. The handles of a row are connectable (React Flow in loose mode, so it doesn't matter which of the four handles is used), except in a removed row and in compact nodes. The key belongs to the row the drag started from, and points at the one it ended on (`onConnectStart` keeps the start, since React Flow calls the source whichever handle kind a drag begins at). `connectColumns` makes it with `addForeignKey`, and if the model can't have it (the other column is not a key, the types differ…) takes it away again and shows the validation message as a toast; a column or table that is read-only can't start a key, but can be pointed at.

A click on a line opens `editors/FkPopover.tsx` where it was clicked: the key (`invoices.user_id → users.id`), what happens on delete and on update (shadcn `Select`: no action, restrict, cascade, set null, set default), and Remove. For a key the change drops it offers Restore instead (which M8 left for here), and for a read-only key it says why and offers nothing. Changing the action of a key that is in the database is a drop and an add in the diff (two changes), which the e2e test checks. Its open state is `editing` = `<key id>:fk` again, with the position of the click kept by the canvas.

**Rationale:** the plan's M12, with the validation done on the new key instead of leaving an invalid one that no node shows until M17.

## The node footer, and the index and check editors (M13, M14)

**Date & time:** 2026-10-30 18:20

Every table has a bar at its foot (`canvas/NodeFooter.tsx`, `FOOTER_HEIGHT` 28 px, counted in `nodeHeight`): "2 indexes · 1 check", and, to the right, what depends on the table and pgsketch doesn't edit ("1 view", names on hover; sequences are left out, since an identity or serial column has its own). A click opens it into two lists, Indexes and Constraints, with "+ Index" and "+ Check" under them; opening it is local to the node, and an index or check being added opens it and leaves it open. The toolbar has Add index and Add check too, which open the same editors. The lists show state like rows do (green, amber, struck through, red outline, lock), a removed one comes back by a click, and the name of an index or constraint is renamed in place (which stops its name following its table and columns).

`IndexEditor` picks columns in the order they are clicked (each shows its place; clicking again takes it out) and has a Unique box; its name is the one `assignNames` gives (`invoices_total_user_id_idx`). `CheckEditor` is an `ExpressionInput` whose answer carries the columns the check uses, and "Add check" is on once Postgres has read it; the name follows the columns (`line_items_check` for several, `line_items_label_check` for one). When the role can't create temporary tables (the fallback flag from M10) it says so instead of showing an input, and adds nothing.

The footer lists checks and every constraint that is read-only (an exclusion constraint, a deferrable key), but not primary keys, unique constraints or foreign keys, which the rows and lines already show. `ExpressionInput`'s `onAnswer` now gets `null` the moment the text changes, so an editor can never add an answer that belongs to older text (the default popover had the same gap).

**Rationale:** the plan's "N indexes · M checks, expands inline" and its M13 and M14 tests. The layout is made once, so a footer opened into lists makes the node taller than it was laid out for; it can then overlap the table under it until the next arrange.

## Comments (M15)

**Date & time:** 2026-10-30 18:20

A table's comment is edited from its toolbar, a column's from `⋯` → Comment…; both open `editors/CommentPopover.tsx`, a textarea over the header or the row (UI store `editing` = `<id>:comment`). Saving nothing removes the comment. An object with a comment shows a small speech bubble on its header or row, with the text on hover and a click to open it. The store has `setTableComment`. The popover from the row menu opens when the menu has let go of the focus (`onCloseAutoFocus`): opened sooner, the menu took the focus back and closed it at once, which the e2e test showed.

**Rationale:** the plan's M15; the e2e test checks a column's and a table's comment each count as one change and that saving nothing puts the count back.

## Read-only objects and errors on nodes (M16, M17)

**Date & time:** 2026-10-30 18:20

What pgsketch doesn't edit has a lock (`LockIcon`) and the reason on hover, as the table and column had since L8, and now the footer lists too: a read-only index (hover also has its definition from Postgres) or constraint has a lock, its name is text, and it has no delete. Whatever depends on a table is counted in the footer. The e2e test uses a second server with a table of a generated column and an exclusion constraint, and the fixture's partial index and view.

An error on an index or a constraint of a table is an error on the table too: its node is outlined (`aria-invalid`) with the message on hover, and the entry in the footer that has it is outlined too. The e2e test names a new index `invoices`, which clashes with the table of that name in the same schema, and sees both; renaming it again takes them away.

**Rationale:** the plan's M16 and M17. Putting a child's error on the table means a collapsed footer can't hide it.
