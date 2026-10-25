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
