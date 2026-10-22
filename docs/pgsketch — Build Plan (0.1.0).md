# pgsketch — Build Plan (0.1.0)

Oct 22, 2026 · @Pratik Dev

## Overview

pgsketch is a Linux desktop app that connects to a Postgres database, shows its schema as an editable diagram, and generates the migration SQL for whatever you change on the canvas. The user runs that SQL themselves; pgsketch never applies changes to a database.

The core loop is: connect → introspect → edit on the canvas → see the changes highlighted → generate SQL → optionally validate it with a dry run → copy or save it.

### Goals for 0.1.0

- Connect to a Postgres 14+ database with user-entered credentials, a connection string, or the local Unix socket.
- Introspect every non-system schema and render it as a diagram.
- Edit tables, columns, types, defaults, keys, foreign keys, indexes and check constraints directly on the canvas.
- Show pending changes on the diagram: added in green, modified in amber, removed in red with strikethrough.
- Generate an up-only plain SQL migration with risk warnings, wrapped in a transaction.
- Validate the migration with a `BEGIN … ROLLBACK` dry run.
- Detect schema changes made outside the app and block SQL generation while the loaded schema is stale.
- Keep unsaved edits and diagram layouts across app restarts.

### Non-goals for 0.1.0

- Applying migrations to a database.
- Down migrations.
- Undo/redo.
- Rebasing unsaved edits onto an externally changed schema (reload discards them).
- Views, functions, triggers, partitions, RLS policies, domains, sequences, and creating `serial` columns.
- A CLI.
- Multiple open databases per window.
- Packaging other than `.deb`; platforms other than Linux.

## Decisions

Every decision below is settled for 0.1.0; the rest of this plan builds on them.

| Area | Decision |
| --- | --- |
| Name | pgsketch |
| Platform | Linux; packaged as `.deb` only |
| Interface | GUI only, no CLI |
| Connection | Optimistic: try to connect with what the user entered and turn failures into clear messages. Supports host/port, connection string, and the local Unix socket (peer auth) |
| Source of truth | The live database. No project files |
| Databases per window | One; a recent-connections list for switching |
| Postgres versions | 14 and newer |
| Schemas | All non-system schemas; never assume `public` |
| Modeled objects | Schemas, tables, columns, types, defaults, NOT NULL, primary keys, foreign keys (with `ON DELETE`/`ON UPDATE`), unique and check constraints, B-tree indexes (single and composite), enums, identity columns, comments |
| Read-only objects | Partial, expression and non-B-tree indexes, deferrable constraints, `nextval(…)` defaults, and anything unmodeled. Shown, preserved, never dropped |
| New primary keys | `bigint GENERATED ALWAYS AS IDENTITY` |
| `serial` | Not created. Existing ones are preserved via the read-only rule |
| Editing | Directly on the canvas: inline cells, badges, anchored popovers, drag-to-relate. No side panel |
| SQL in the UI | Only for custom default expressions and check constraints |
| Change model | Diff between the loaded schema (baseline) and the edited schema (desired). Original names tracked by stable IDs so renames are exact |
| Undo/redo | Not in 0.1.0. Removed items stay visible and restorable until SQL is generated |
| Change detection | Schema fingerprint polled every 5 s and on window focus. Banner on change. SQL generation and Validate re-check first and are blocked when stale |
| Reload with unsaved edits | Discards the edits (after confirmation) |
| Unsaved edits across restarts | Kept, unless the fingerprint changed while the app was closed |
| Output | Up-only plain SQL, wrapped in `BEGIN; … COMMIT;`, non-transactional statements placed outside with a comment |
| Risk warnings | Summary panel plus a `-- WARNING` comment above each risky statement |
| Validate | Dry run inside `BEGIN … ROLLBACK` with `lock_timeout`; warns first when the host isn't local |
| Delivery | Copy button, and Save via the native save dialog opening in the last-used folder |
| Diagram layout | Positions saved locally per database; auto-layout only on request |
| Runtime | Node only (Electron's bundled Node; pnpm workspaces) |

## Architecture

pgsketch has three parts: a pure TypeScript core, an Electron main process that owns every side effect, and a React renderer that owns the editor.

&#91;embedded content: pgsketch architecture · renderer, main process, Postgres, disk\]

The renderer imports `packages/core` and recomputes the diff on every edit, which drives the live highlighting. The main process imports the same core for introspection, fingerprinting, normalization and validation, and is the only part that talks to Postgres or the disk. The two communicate only through typed IPC channels validated with zod.

**Data flow for one edit:**

1. The user changes something on the canvas.
2. A store action updates `desired`.
3. The derived selector runs `diff(baseline, desired)`, `assessRisk` and validation.
4. The canvas re-renders affected nodes with their new status; the top bar updates its counts.
5. Every second of idle time, the draft is saved to the app store.

**Data flow for Generate SQL:**

1. The renderer asks main for the current fingerprint.
2. If it differs from the loaded one, generation is blocked and the stale banner appears.
3. Otherwise core orders the ops and renders the migration: text for display, plus a statement array for Validate.

## Core package design

`packages/core` holds everything about schemas and SQL, with no Electron, React or `pg` dependency. Functions that need the database receive a small `Query` function (`(sql, params) => Promise<rows>`) instead of a driver, so the same code runs in the renderer (diffing on every edit) and in the main process (introspection, validation).

### Schema model

The model is normalized: flat maps keyed by ID, with references by ID. This keeps updates shallow, matches React Flow's node-by-ID model, and lets the diff engine match objects by identity.

```ts
type Id = string;

interface SchemaModel {
  schemas: Record<Id, Schema>;
  tables: Record<Id, Table>;
  columns: Record<Id, Column>;
  constraints: Record<Id, Constraint>; // pk | unique | check | fk
  indexes: Record<Id, Index>;
  enums: Record<Id, EnumType>;
  readOnly: Record<Id, ReadOnlyObject>; // views, triggers, sequences, unsupported indexes...
}

interface Column {
  id: Id;
  tableId: Id;
  name: string;
  position: number;
  type: PgType;              // { name, schema?, params?: number[], isArray }
  notNull: boolean;
  default: DefaultValue | null; // { kind: 'preset' | 'constant' | 'expression' | 'identity', ... }
  comment: string | null;
  readOnlyDefault?: string;  // e.g. nextval(...) from serial; shown, never edited
}
```

**Identity.** Objects loaded from the database get IDs derived from Postgres identifiers (`t:<table oid>`, `c:<table oid>:<attnum>`, `k:<constraint oid>`, `i:<index oid>`, `e:<type oid>`). These stay stable for the whole session and across reloads, as long as the object still exists. New objects created in the editor get a random UUID. Because a renamed column keeps its ID, the diff engine knows it's a rename, never a drop plus an add.

**Two models.** The editor holds `baseline` (exactly what was introspected) and `desired` (baseline plus the user's edits). Removing something from the canvas deletes it from `desired` only. The diff is always `diff(baseline, desired)`.

### Model validation

Runs on `desired` before diffing. Errors block SQL generation and are shown on the offending node:

- Names are non-empty, unique within their scope (tables per schema, columns per table, constraint and index names per schema), and at most 63 bytes (Postgres truncates longer identifiers silently).
- Every table has at most one primary key.
- A foreign key references columns covered by a primary key or unique constraint on the target table, with the same number of columns and compatible types.
- Type parameters are valid (`varchar` length > 0, `numeric` scale ≤ precision).
- Defaults are compatible with the column type (presets are filtered by type; custom expressions are checked during normalization).

### Introspection

Handwritten queries against `pg_catalog`, one per object kind, run inside a single `REPEATABLE READ` read-only transaction so all results describe the same moment:

| Query | Source catalogs | Captures |
| --- | --- | --- |
| Schemas | `pg_namespace` | All except `pg_catalog`, `information_schema`, `pg_toast*`, `pg_temp*` |
| Tables | `pg_class` (`relkind = 'r'`), `obj_description` | Name, schema, comment. Partitioned tables (`'p'`) go to read-only |
| Columns | `pg_attribute`, `pg_attrdef`, `format_type`, `pg_get_expr`, `col_description` | Name, position, type, NOT NULL, default, identity (`attidentity`), comment |
| Constraints | `pg_constraint`, `pg_get_constraintdef` | PK, unique, check, FK (with actions), deferrable flag |
| Indexes | `pg_index`, `pg_class`, `pg_am`, `pg_get_indexdef` | Columns, uniqueness, method, predicate, expressions |
| Enums | `pg_type` (`typtype = 'e'`), `pg_enum` ordered by `enumsortorder` | Name, labels in order |
| Read-only objects | `pg_class` (views, sequences), `pg_trigger`, `pg_proc`, `pg_policy` | Name and kind, for display and safety |

Objects owned by extensions (found through `pg_depend` with `deptype = 'e'`) are excluded entirely, so installing an extension never makes its internal tables appear on the canvas.

Classification into editable vs. read-only happens here: a unique B-tree index with plain columns is editable; one with a `WHERE` clause, an expression, or a GIN/GiST method becomes a read-only object. Index entries that merely back a PK or unique constraint are folded into that constraint, not shown twice.

### Fingerprint

One query that hashes the catalog into a single value, covering exactly the same objects introspection reads (including read-only ones). The app compares it to the fingerprint captured at load time. The query and its object coverage live next to the introspection queries, and a test asserts that every catalog an introspection query reads also appears in the fingerprint, so the two can't drift apart as features are added.

### Diff engine

`diff(baseline, desired): ChangeOp[]` compares objects by ID:

- In `desired` only → create.
- In `baseline` only → drop.
- In both → compare field by field and emit one operation per changed property (rename, type change, nullability, default, comment...).
- Read-only objects never produce operations. Anything that would require dropping one (for example, a column a view depends on) is reported as a blocking error rather than generated.

```ts
type ChangeOp =
  | { kind: 'createSchema'; schema: Schema }
  | { kind: 'createEnum'; enum: EnumType }
  | { kind: 'addEnumValue'; enumId: Id; value: string; after?: string }
  | { kind: 'renameEnumValue'; enumId: Id; from: string; to: string }
  | { kind: 'recreateEnum'; before: EnumType; after: EnumType } // value removed or reordered
  | { kind: 'dropEnum'; enum: EnumType }
  | { kind: 'createTable'; table: Table; columns: Column[]; pk?: Constraint }
  | { kind: 'renameTable'; tableId: Id; from: string; to: string }
  | { kind: 'dropTable'; table: Table }
  | { kind: 'addColumn'; column: Column }
  | { kind: 'renameColumn'; columnId: Id; from: string; to: string }
  | { kind: 'alterColumnType'; columnId: Id; from: PgType; to: PgType }
  | { kind: 'setNotNull' | 'dropNotNull'; columnId: Id }
  | { kind: 'setDefault'; columnId: Id; to: DefaultValue }
  | { kind: 'dropDefault'; columnId: Id }
  | { kind: 'dropColumn'; column: Column }
  | { kind: 'addConstraint'; constraint: Constraint }
  | { kind: 'dropConstraint'; constraint: Constraint }
  | { kind: 'addIndex'; index: Index }
  | { kind: 'dropIndex'; index: Index }
  | { kind: 'setComment'; target: CommentTarget; to: string | null };
```

A changed constraint or index (different columns or actions) is expressed as drop + add, since Postgres can't alter them in place. A renamed constraint or index uses `RENAME`.

### Operation ordering

The renderer sorts operations into fixed phases so every statement's dependencies exist when it runs:

1. Outside the transaction, before `BEGIN`: `addEnumValue` (a new enum value can't be used in the same transaction that adds it).
2. Create schemas.
3. Create enums, rename enum values.
4. Drop foreign keys that are dropped or changed, and every FK that points at a table or column being dropped.
5. Drop other constraints and indexes that are dropped or changed.
6. Renames: schemas, tables, columns, constraints, indexes.
7. Create tables (with columns and primary key, without foreign keys).
8. Add columns.
9. Recreate enums (rename old type, create new, convert columns, drop old).
10. Alter columns: type, defaults, nullability.
11. Drop columns.
12. Drop tables, in reverse dependency order.
13. Add constraints and indexes (non-FK).
14. Add foreign keys.
15. Drop enums.
16. Comments.

Within a phase, operations are sorted by qualified name, so the same changes always produce byte-identical SQL. That determinism is what makes snapshot tests reliable.

### Risk classification

`assessRisk(op, baseline): Risk[]` returns zero or more risks, each with a level and a human-readable message:

| Level | Operations |
| --- | --- |
| Destructive (data lost) | `dropTable`, `dropColumn`, `dropEnum`, `recreateEnum` removing a value, lossy type changes |
| May fail (depends on data) | `setNotNull`, adding unique/check/FK constraints, PK changes, type changes that need a cast, `recreateEnum` |
| Breaks app code | `renameTable`, `renameColumn` |
| Slow on large tables | Type changes that rewrite the table; `setNotNull` and constraint additions that scan it |
| Safe | Everything else |

Type changes go through a lookup table with two lists: known-safe widenings (`smallint → integer → bigint`, `varchar(n) → varchar(m > n)`, `varchar → text`, larger `numeric` precision with the same scale) and known-lossy conversions (`numeric` scale decrease, `float → integer`, `timestamp(tz) → date`, `text → varchar(n)`). Anything in neither list is treated as **may fail**. Unknown cases default to a warning, never to safe.

### SQL rendering

`render(ops, risks): string` produces the migration text:

- Every identifier goes through `quoteIdent` (always double-quoted, embedded quotes doubled) and every literal through `quoteLiteral`. No string concatenation of names anywhere else.
- Every object is schema-qualified: `"billing"."invoices"`.
- Type changes use `USING "col"::newtype` whenever no implicit conversion exists.
- Header comment: generated by pgsketch, timestamp, database name, operation and risk counts.
- Each risky statement is preceded by `-- WARNING (<level>): <message>`.
- Transactional statements are wrapped in `BEGIN;` / `COMMIT;`; phase 1 statements sit above `BEGIN` with a comment explaining why.

### Expression normalization

Postgres stores defaults and check expressions in a normalized form (`CURRENT_TIMESTAMP` comes back differently than typed, `'active'` comes back as `'active'::text`). Comparing raw text would produce false changes.

`normalizeExpression(query, expr, context)` asks the connected database for the canonical form:

1. `BEGIN`.
2. Create a temporary table with a column of the target type and the expression as its default (or as a check constraint).
3. Read it back with `pg_get_expr` (or `pg_get_constraintdef`).
4. `ROLLBACK`.

The desired model stores only normalized expressions, so the diff compares like with like. A syntax or type error at step 2 is shown on the input as a validation error, which doubles as live checking for custom expressions. Presets (`now()`, `gen_random_uuid()`, constants) are normalized the same way once per session and cached.

## Desktop app design

The main process owns everything with side effects (the database connection, local storage, files, keyring); the renderer owns the editor and calls the main process only through a typed preload API.

### Main process services

| Service | Responsibility |
| --- | --- |
| Connection manager | One `pg.Client` per window. Connect, map errors, disconnect, expose a `Query` function to other services. Sets `application_name = 'pgsketch'` |
| Introspector | Runs the core introspection in a read-only transaction and returns `{ model, fingerprint }` |
| Fingerprint poller | Every 5 s while connected, and on window focus. Pushes `schema:changed` to the renderer when the value differs from the loaded one |
| Normalizer | Runs core `normalizeExpression` for the renderer, with a per-session cache |
| Validator | Runs the dry run (see Validate flow) |
| App store | `better-sqlite3` database for connections, drafts, layouts and settings |
| Secrets | Encrypts and decrypts passwords with `safeStorage` |
| File service | Native save dialog, remembers the last folder, writes the `.sql` file |

### IPC API

Every channel has a zod schema for its input, validated in the main process before anything runs.

| Channel | Input | Returns |
| --- | --- | --- |
| `connection.test` | Connection params | OK or a mapped error |
| `connection.open` | Connection params, remember flag | Session info (server version, database, host kind) |
| `connection.close` | none | none |
| `connection.recent` | none | Saved connections without passwords |
| `connection.forget` | Connection ID | none |
| `schema.load` | none | `{ model, fingerprint }` |
| `schema.fingerprint` | none | Current fingerprint |
| `expr.normalize` | Expression, type, kind (default or check) | Normalized text or an error |
| `sql.validate` | Statements, expected fingerprint | Per-statement results |
| `sql.save` | SQL text, suggested filename | Saved path, or cancelled |
| `draft.get` / `draft.put` / `draft.clear` | Connection + database key, draft | Draft |
| `layout.get` / `layout.put` | Connection + database key, positions | Positions |

Events from main to renderer: `schema:changed`, `connection:lost`.

### Connection screen

- Fields: host (default `localhost`), port (`5432`), user (`postgres`), password, database. A toggle switches to a single connection-string field, and a "Local socket" option sets the host to `/var/run/postgresql` with no password (peer auth).
- "Remember" saves the connection; the password is stored encrypted, separately.
- Recent connections are listed above the form; clicking one connects immediately.
- Errors are mapped from driver errors:

| Signal | Message |
| --- | --- |
| `ECONNREFUSED` | Couldn't reach Postgres at host:port. Is it running? |
| `ENOTFOUND` | Host not found |
| Timeout (5 s) | Connection timed out |
| `28P01` | Password authentication failed for user |
| `28000` | Authentication rejected (check `pg_hba.conf` or peer auth user) |
| `3D000` | Database doesn't exist on this server |
| Server version < 14 | pgsketch needs Postgres 14 or newer (found X) |

### Session start

1. Connect and check the server version.
2. `schema.load`: baseline model + fingerprint.
3. Load the saved draft for this connection and database. If its stored fingerprint equals the current one, restore it as `desired`. Otherwise discard it and show a one-line notice.
4. Load saved layout positions. Tables without a position are placed by auto-layout.
5. Start the fingerprint poller.

### Editor state

Zustand stores, normalized, no Immer to start:

- **Schema store:** `baseline`, `desired`, `loadedFingerprint`, `stale` flag. Actions for every edit (`renameColumn`, `setColumnType`, `toggleNotNull`, `addTable`, `removeColumn`, `restore`...). Each action edits `desired` only.
- **Derived diff:** a memoized selector computes `diff(baseline, desired)`, `assessRisk` and validation errors whenever `desired` changes. From the ops it builds a status map: `id → 'added' | 'modified' | 'removed'` plus old values for hover.
- **UI store:** selection, the cell being edited, open popover, zoom level.
- **Layout store:** node positions; saved to the app store debounced by 500 ms.
- **Draft persistence:** `desired` + `loadedFingerprint` saved debounced by 1 s.

### Canvas

The canvas renders the **union** of `baseline` and `desired`: removed objects come from `baseline` and are drawn struck through in red, so they can be restored with a click (restore copies the object back from `baseline` into `desired`).

**Table node:**

- Header: `schema.table`. Double-click to rename. Hover or selection shows a toolbar (`NodeToolbar`): add column, add index, add check, delete table.
- Column rows: name · type · badges (PK, NN, UQ) · default chip (`= now()`) · FK target (`→ orgs.id`). A connection handle on each row's left and right edge.
- Footer: "N indexes · M checks", expands inline.
- New table: double-click empty canvas.

**Editing interactions:**

| Target | Interaction |
| --- | --- |
| Table or column name | Click → inline input. Enter/Tab commits, Esc cancels |
| Type | Click → searchable picker popover; parameter inputs for `varchar`, `numeric`, etc.; array toggle |
| PK / NN / UQ | Click badge to toggle (faded when off) |
| Default | Click chip → presets for the type, constant value, custom expression |
| Row actions | Hover `⋯` → comment, move up/down, delete |
| Foreign key | Drag from a column's handle to a column in another table |
| FK edge | Click → popover with `ON DELETE`, `ON UPDATE`, remove |
| Index | Footer → pick columns in order, toggle unique |
| Check constraint | Footer → expression input (normalized live) |
| Keyboard | Tab moves name → type → next row; Enter on last row adds a column |

**Rendering rules:**

- Cells render plain text; only the cell being edited mounts an input.
- Inputs carry `nodrag nopan`; Delete/Backspace never remove nodes while an input has focus.
- Popovers render in a portal outside the zoomed viewport, positioned with Floating UI (via Radix).
- Below 70% zoom, nodes render in a simplified form (table name and column count only), and clicking one zooms to it before editing.
- FK edges are custom SVG edges with crow's-foot markers for one-to-many.
- Auto-layout (`elkjs` in a worker, one port per column) runs only from the "Auto-arrange" button or for tables without a saved position.

**Diff highlighting:**

| Status | Style |
| --- | --- |
| Added | Green left border and tint |
| Modified | Amber; hover shows the old value (`varchar(100) → varchar(255)`) |
| Removed | Red, struck through, faded; click to restore |
| Validation error | Red outline with the message on hover |
| Read-only | Grey, lock icon, no edit affordances |

### Top bar

Database name and host, a change counter ("5 changes · 1 destructive"), **Generate SQL**, **Reload**, **Auto-arrange**, and **Disconnect**. Generate SQL is disabled while there are validation errors or no changes.

### Change detection flow

1. Poller sees a new fingerprint → sends `schema:changed` → `stale = true`.
2. Banner: "The database schema changed outside pgsketch." with **Reload**.
3. Reload with no edits: reload immediately. With edits: confirm "Reload and discard N unsaved changes?".
4. While stale, Generate SQL and Validate are disabled with an explanation.
5. Generate SQL and Validate always call `schema.fingerprint` first, even if the poller hasn't fired, so correctness never depends on poll timing.

### SQL panel

A bottom drawer opened by Generate SQL:

- Risk summary: counts per level, each expandable to its list.
- The SQL in a read-only CodeMirror view with PostgreSQL highlighting.
- **Copy**, **Save** (native dialog, suggested name `YYYYMMDD_HHmmss_pgsketch.sql`, opens in the last-used folder), **Validate**.
- The panel regenerates when `desired` changes while it's open.

### Validate flow

1. Re-check the fingerprint; abort if stale.
2. If the host isn't local (`localhost`, `127.0.0.1`, `::1`, or a socket path), confirm first: it takes locks on that server.
3. On the session connection: `BEGIN`, `SET LOCAL lock_timeout = '3s'`, `SET LOCAL statement_timeout = '30s'`.
4. Run the transactional statements one at a time, recording each result, stopping at the first error.
5. `ROLLBACK` always, in a `finally`.
6. Show results next to each statement: passed, failed (with the Postgres error and code), not run, or skipped (statements that can't run in a transaction, such as `ADD VALUE`, are listed as not validated).

Statements are passed as an array from the renderer's rendered ops, so the main process never splits SQL text.

## Local data, security and packaging

All app state lives in one local SQLite file; passwords are the only secret, and they never leave the keyring-backed encryption.

### Paths

| What | Where |
| --- | --- |
| App | `/opt/pgsketch/`, launcher in `/usr/share/applications/pgsketch.desktop` |
| App data | `~/.local/share/pgsketch/pgsketch.db` |
| Logs | `~/.local/state/pgsketch/main.log` |

### App database schema

```sql
CREATE TABLE connections (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL,           -- params | url | socket
  host          TEXT,
  port          INTEGER,
  user_name     TEXT,
  database      TEXT NOT NULL,
  password_enc  BLOB,                    -- safeStorage ciphertext, null if none
  last_used_at  INTEGER NOT NULL
);

CREATE TABLE drafts (
  db_key        TEXT PRIMARY KEY,        -- connection id + database name
  fingerprint   TEXT NOT NULL,           -- baseline fingerprint the draft was made on
  desired_json  TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE layouts (
  db_key        TEXT NOT NULL,
  object_id     TEXT NOT NULL,           -- table id
  x REAL NOT NULL, y REAL NOT NULL,
  PRIMARY KEY (db_key, object_id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                    -- JSON
);
```

Connection-string connections store the URL with the password removed; the password goes into `password_enc`. Migrations use numbered `.sql` files tracked with `PRAGMA user_version`. Pragmas at open: `journal_mode = WAL`, `foreign_keys = ON`.

### Security baseline

- Renderer: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Strict CSP: bundled scripts only, no inline scripts, no remote resources.
- Preload exposes only the typed API from the IPC table; never raw `ipcRenderer`.
- Every IPC input validated with zod in the main process.
- Passwords: `safeStorage` (libsecret on Linux). If the keyring backend is unavailable, `safeStorage` falls back to a weak hardcoded key on Linux, so the app checks `safeStorage.getSelectedStorageBackend()` and refuses to remember passwords when it reports `basic_text`.
- All SQL built through `quoteIdent` and `quoteLiteral`; user values sent to `pg` as parameters wherever possible.
- Database object names and comments are rendered as React text, never as HTML.
- Logs never contain passwords or full connection strings.

### Packaging

- `electron-builder` with the `deb` target; `better-sqlite3` rebuilt for Electron's ABI during packaging.
- Desktop entry and icon installed for the applications menu.
- The packaged app is smoke-tested in CI (launch, open the connect screen, quit), not just dev mode.
- Version 0.1.0; GitHub Release with the `.deb` attached.

## Tech stack and repository structure

A pnpm monorepo with two workspaces: `packages/core` (pure TypeScript) and `apps/desktop` (Electron). Node everywhere.

### Tech stack

| Area | Choice | Used for |
| --- | --- | --- |
| Monorepo | pnpm workspaces | `core` + `desktop`, shared TS config |
| Language | TypeScript, strict | Everything |
| Desktop | Electron + `electron-vite` | Main, preload, renderer builds |
| UI | React, Tailwind, shadcn/ui | Screens, popovers, command-style pickers |
| State | Zustand (normalized; Immer only if needed later) | Editor stores |
| Canvas | React Flow (`@xyflow/react`) | Nodes, handles, edges, node toolbar |
| Layout | `elkjs` in a web worker | Auto-arrange with per-column ports |
| Positioning | Radix Popover (Floating UI) | Portaled popovers |
| SQL view | CodeMirror 6 + `@codemirror/lang-sql` | SQL preview, expression inputs |
| Postgres | `pg` (node-postgres) | Connection, introspection, validate |
| Validation | zod | IPC inputs, connection forms |
| App data | `better-sqlite3` | Connections, drafts, layouts, settings |
| Secrets | Electron `safeStorage` | Passwords |
| Unit tests | Vitest | Core logic, stores |
| DB tests | Testcontainers (`@testcontainers/postgresql`) | Real Postgres 14–18 |
| Property tests | `fast-check` | Diff round trips |
| E2E | Playwright `_electron` | Full app flows |
| Packaging | `electron-builder` (`deb`) | Release |
| CI | GitHub Actions | Lint, tests, PG version matrix, package |

### Repository structure

Files are deliberately small and single-purpose, so each build phase touches only a few of them.

```text
pgsketch/
  package.json · pnpm-workspace.yaml · tsconfig.base.json · .github/workflows/ci.yml
  packages/core/
    src/
      model/        types.ts · ids.ts · validate.ts
      sql/          quote.ts · pgtype.ts
      introspect/   query.ts (Query type, transaction helper) · schemas.ts · tables.ts · columns.ts
                    constraints.ts · indexes.ts · enums.ts · readonly.ts · extensions.ts · index.ts
      fingerprint/  fingerprint.ts
      diff/         ops.ts · schemas.ts · enums.ts · tables.ts · columns.ts · constraints.ts
                    indexes.ts · comments.ts · readonly-guard.ts · index.ts
      order/        order.ts
      risk/         type-changes.ts · assess.ts
      render/       schemas.ts · enums.ts · tables.ts · columns.ts · constraints.ts · indexes.ts
                    comments.ts · migration.ts
      normalize/    expression.ts
      index.ts
    test/           pg.ts (container helper) · roundtrip.ts · arbitraries.ts · fixtures/
  apps/desktop/
    src/
      shared/       ipc-contract.ts
      main/         index.ts · window.ts · ipc.ts · log.ts
        services/   connection.ts · errors.ts · introspector.ts · poller.ts · normalizer.ts
                    validator.ts · secrets.ts · files.ts
        store/      db.ts · migrations/001_init.sql · connections.ts · drafts.ts · layouts.ts · settings.ts
      preload/      index.ts
      renderer/
        main.tsx · App.tsx · api.ts
        screens/    Connect.tsx · Editor.tsx
        stores/     schema.ts · ui.ts · layout.ts · derived.ts · persistence.ts
        canvas/     Canvas.tsx · TableNode.tsx · ColumnRow.tsx · NodeFooter.tsx · TableToolbar.tsx
                    FkEdge.tsx · CompactNode.tsx · status.ts
        editors/    InlineText.tsx · TypePicker.tsx · DefaultPopover.tsx · FkPopover.tsx
                    IndexEditor.tsx · CheckEditor.tsx · ExpressionInput.tsx
        layout/     elk.worker.ts · autoLayout.ts
        chrome/     TopBar.tsx · StaleBanner.tsx
        sql/        SqlPanel.tsx · RiskSummary.tsx · SqlView.tsx · ValidateResults.tsx
    e2e/            *.spec.ts
    electron-builder.yml
```

## Build phases

The build is 106 thin phases in 16 milestones; each phase changes at most three source files and ends with a passing test and a commit.

**Rules for every phase:**

- The **Files** column lists source files created or changed. Each phase also adds or updates its own test file, which isn't counted. Setup phases that run generators (marked *generated*) are the only exception to the file limit.
- A phase is done when its **Test** passes locally and in CI. Never start the next phase on a red build.
- Core milestones (B–H) need no UI and come first: by the end of H, the whole schema-to-SQL pipeline is proven against real Postgres before any canvas work starts.
- Tests marked *DB* run against a real Postgres container through `test/pg.ts`.

### A. Project setup

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| A1 | Initialize the pnpm monorepo, strict base TS config, ESLint, Prettier | *generated* (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, lint configs) | `pnpm install` and `pnpm lint` succeed |
| A2 | Scaffold `packages/core` with Vitest | *generated* (package config, `src/index.ts`, `vitest.config.ts`) | A placeholder Vitest test passes |
| A3 | Scaffold `apps/desktop` with the electron-vite React TS template | *generated* | `pnpm dev` opens a window |
| A4 | Add Tailwind and initialize shadcn/ui in the renderer | *generated* | A shadcn `Button` renders with Tailwind styles |
| A5 | CI: install, lint, typecheck, unit tests | `.github/workflows/ci.yml` | A push produces a green run |
| A6 | Postgres test helper with Testcontainers, version from `PG_VERSION` env (default 16) | `core/test/pg.ts` | *DB*: `SELECT version()` returns the expected major version |
| A7 | CI matrix for Postgres 14–18 on DB tests | `ci.yml` | Five green DB jobs |

### B. Core model and SQL primitives

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| B1 | All schema model interfaces | `model/types.ts` | A fixture model typechecks |
| B2 | ID helpers: OID-based IDs and `newId()` | `model/ids.ts` | Same OIDs give same IDs; new IDs are unique |
| B3 | `quoteIdent`, `quoteLiteral`, `qualified(schema, name)` | `sql/quote.ts` | Embedded quotes, mixed case, reserved words, unicode, empty strings |
| B4 | Parse `format_type` output into `PgType`; render `PgType` back to SQL | `sql/pgtype.ts` | Table-driven: `varchar(255)`, `numeric(10,2)`, `timestamptz`, `text[]`, schema-qualified enum |
| B5 | Validation: empty, duplicate and over-63-byte names | `model/validate.ts` | Each rule fires on a bad fixture and stays silent on a good one |
| B6 | Validation: one PK per table, FK target coverage, column count and type compatibility, type parameters | `model/validate.ts` | Same pattern as B5 |

### C. Introspection

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| C1 | `Query` type and read-only `REPEATABLE READ` snapshot helper | `introspect/query.ts` | *DB*: queries inside report `repeatable read` and reject writes |
| C2 | Extension-owned object detection via `pg_depend` | `introspect/extensions.ts` | *DB*: after `CREATE EXTENSION pg_trgm`, its objects are listed |
| C3 | Schemas query | `introspect/schemas.ts` | *DB*: user schemas returned, system schemas excluded |
| C4 | Tables query, comments, partitioned tables marked read-only | `introspect/tables.ts` | *DB*: fixture tables with and without comments |
| C5 | Columns query: types, NOT NULL, raw defaults, identity, comments | `introspect/columns.ts` | *DB*: one column per feature, compared field by field |
| C6 | Constraints query: PK, unique, check, FK with actions, deferrable flag | `introspect/constraints.ts` | *DB*: composite PK, multi-column FK with `ON DELETE CASCADE` |
| C7 | Indexes query: editable vs. read-only classification, constraint-backed indexes folded | `introspect/indexes.ts` | *DB*: plain, unique, partial, expression and GIN indexes classified correctly |
| C8 | Enums query with ordered labels | `introspect/enums.ts` | *DB*: labels returned in `enumsortorder` |
| C9 | Read-only objects and their dependencies (views on columns, triggers on tables, `nextval` sequences) | `introspect/readonly.ts` | *DB*: a view depending on a column is linked to that column |
| C10 | Assemble the full model in one snapshot | `introspect/index.ts` | *DB*: snapshot test of `fixtures/basic.sql` (two schemas, cross-schema FK, enum, view) |

### D. Fingerprint

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| D1 | Fingerprint query | `fingerprint/fingerprint.ts` | *DB*: stable when nothing changes; changes after each kind of DDL; unchanged after `INSERT`/`UPDATE` |
| D2 | Coverage guard: every catalog read by introspection is covered by the fingerprint | `fingerprint/fingerprint.ts` | A test scans the exported introspection SQL for `pg_*` catalogs and fails if one is missing |

### E. Diff engine

All unit tests: two hand-built models in, expected `ChangeOp[]` out.

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| E1 | `ChangeOp` union type | `diff/ops.ts` | Typecheck |
| E2 | Schemas: create, rename | `diff/schemas.ts` | Create and rename cases |
| E3 | Tables: create, rename, drop | `diff/tables.ts` | Renamed table keeps its ID and yields `renameTable`, not drop + create |
| E4 | Columns: add, drop, rename | `diff/columns.ts` | Same identity check for columns |
| E5 | Columns: type, NOT NULL, default changes | `diff/columns.ts` | One op per changed property |
| E6 | Constraints: add, drop, rename; changed = drop + add | `diff/constraints.ts` | Changed FK action yields drop + add |
| E7 | Indexes: same rules as constraints | `diff/indexes.ts` | Column order change yields drop + add |
| E8 | Enums: create, add value, rename value, recreate on removal/reorder, drop | `diff/enums.ts` | Each case |
| E9 | Comments on tables and columns | `diff/comments.ts` | Set, change, clear |
| E10 | Read-only guard: block changes that would drop dependent read-only objects | `diff/readonly-guard.ts` | Dropping a column used by a view returns a blocking error, no op |
| E11 | Assemble the diff, including dropping FKs that point at dropped tables or columns | `diff/index.ts` | Dropping a referenced table also yields `dropConstraint` for the referencing FK |

### F. Ordering and SQL rendering

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| F1 | Phase assignment and deterministic sort | `order/order.ts` | FK added after its target table; same input gives identical order |
| F2 | Render schema and enum statements | `render/schemas.ts`, `render/enums.ts` | Snapshot per op, including the four-step enum recreate |
| F3 | Render table statements | `render/tables.ts` | Snapshot: create with identity PK, rename, drop |
| F4 | Render column statements, with `USING` casts where needed | `render/columns.ts` | Snapshot: `text → integer` includes `USING` |
| F5 | Render constraint and index statements | `render/constraints.ts`, `render/indexes.ts` | Snapshot: composite FK with actions |
| F6 | Render comment statements | `render/comments.ts` | Snapshot with a quote inside the comment |
| F7 | Assemble the migration: header, pre-transaction statements, `BEGIN`/`COMMIT`; return text and statement array | `render/migration.ts` | Snapshot of a full migration with an `ADD VALUE` placed before `BEGIN` |

### G. Risk classification

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| G1 | Type-change matrix: safe widenings and lossy conversions | `risk/type-changes.ts` | Table-driven; an unlisted pair returns "may fail" |
| G2 | `assessRisk` for every op kind | `risk/assess.ts` | One case per level |
| G3 | Warning comments and risk counts in the migration | `render/migration.ts` | Snapshot shows `-- WARNING` above a `DROP COLUMN` |

### H. Round trips and normalization

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| H1 | Round-trip helper: apply migration to a fresh database, re-introspect, compare by qualified names | `test/roundtrip.ts` | *DB*: 20 hand-written edit cases round-trip exactly |
| H2 | `fast-check` arbitraries for models and edits | `test/arbitraries.ts` | *DB*: property test, 200 runs, every generated edit round-trips |
| H3 | Expression normalization through a rolled-back temp table | `normalize/expression.ts` | *DB*: `CURRENT_TIMESTAMP` and `now()` normalize to the same text; invalid expressions return the Postgres error |
| H4 | Normalization used by round trips so defaults compare cleanly | `test/roundtrip.ts` | *DB*: round trips with custom defaults produce no phantom diff |

### I. Desktop main process foundation

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| I1 | All IPC channel names and zod schemas | `shared/ipc-contract.ts` | Valid inputs parse; malformed ones are rejected |
| I2 | Generic IPC register helper and typed preload bridge | `main/ipc.ts`, `preload/index.ts` | A `ping` channel round-trips; an invalid payload is rejected in main |
| I3 | Logger with password and connection-string redaction | `main/log.ts` | A logged URL has its password removed |
| I4 | App database with migrations | `store/db.ts`, `store/migrations/001_init.sql` | Temp database reaches `user_version = 1` with all four tables |
| I5 | Connections repository | `store/connections.ts` | Insert, list by recency, delete |
| I6 | Secrets with keyring backend check | `services/secrets.ts` | With `basic_text` mocked, remembering a password is refused |
| I7 | Driver error mapping | `services/errors.ts` | Each code from the error table maps to its message |
| I8 | Connection service: open, test, close, version check, `application_name` | `services/connection.ts` | *DB*: connects; Postgres 13 is rejected with the version message |
| I9 | Register connection channels | `main/index.ts` | E2E: the renderer's `connection.test` reaches a container |

### J. Connection screen

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| J1 | Typed renderer API client and screen switching | `renderer/api.ts`, `renderer/App.tsx` | App shows the Connect screen by default |
| J2 | Connect form: params, URL and socket modes, zod validation | `screens/Connect.tsx` | Component test: missing database name blocks submit |
| J3 | Submit, mapped error display, recent connections, remember | `screens/Connect.tsx` | E2E: wrong password shows the message; success opens the editor |

### K. Schema loading and editor state

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| K1 | Introspector service and `schema.load` channel | `services/introspector.ts`, `main/index.ts` | E2E: the editor receives the fixture model |
| K2 | Schema store: baseline, desired, load, rename actions | `stores/schema.ts` | Rename changes `desired` only |
| K3 | Derived diff, risks, validation and status map | `stores/derived.ts`, `canvas/status.ts` | Renamed column has status `modified` with its old name |
| K4 | Store actions: add/remove table and column, flags, type, default, restore | `stores/schema.ts` | Remove then restore leaves an empty diff |
| K5 | Store actions: constraints, indexes, FKs, checks | `stores/schema.ts` | Each action produces the expected op |

### L. Canvas rendering

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| L1 | React Flow canvas fed by the union of baseline and desired | `canvas/Canvas.tsx`, `screens/Editor.tsx` | E2E: every fixture table appears as a node |
| L2 | Static table node and column rows | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | Component test: badges, default chip and FK target render |
| L3 | FK edges with crow's-foot markers and per-column handles | `canvas/FkEdge.tsx`, `canvas/ColumnRow.tsx` | E2E: edge count equals FK count |
| L4 | Auto-layout in a worker with per-column ports | `layout/elk.worker.ts`, `layout/autoLayout.ts` | Unit: ELK output maps to node positions; no overlapping nodes |
| L5 | Layout repository and channels | `store/layouts.ts`, `main/index.ts` | Positions saved and read back per database |
| L6 | Renderer layout store with debounced save and restore | `stores/layout.ts` | E2E: moved node keeps its position after restart |
| L7 | Compact nodes below 70% zoom | `canvas/CompactNode.tsx`, `canvas/Canvas.tsx` | E2E: zooming out switches node type |
| L8 | Status styling: added, modified, removed, error, read-only | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | Component test: each status applies its style |

### M. Canvas editing

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| M1 | Inline text editing for table and column names | `editors/InlineText.tsx`, `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | E2E: rename a column; it turns amber and the change count updates |
| M2 | Input safety: `nodrag nopan`, Delete/Backspace guarded | `editors/InlineText.tsx`, `canvas/Canvas.tsx` | E2E: selecting text doesn't move the node; Backspace doesn't delete it |
| M3 | Badge toggles for PK, NN, UQ | `canvas/ColumnRow.tsx` | E2E: toggling NN produces `setNotNull` |
| M4 | Type picker popover with parameters and array toggle | `editors/TypePicker.tsx`, `canvas/ColumnRow.tsx` | Component test: choosing `varchar` shows a length input |
| M5 | Add and delete columns; Tab/Enter keyboard flow | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | E2E: create three columns using only the keyboard |
| M6 | New table on double-click; table toolbar | `canvas/Canvas.tsx`, `canvas/TableToolbar.tsx` | E2E: a new table appears at the cursor with its name focused |
| M7 | Removed items struck through and restorable | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | E2E: delete then click restores, diff empty |
| M8 | Normalizer service and `expr.normalize` channel | `services/normalizer.ts`, `main/index.ts` | *DB*: returns normalized text and errors |
| M9 | Expression input with live normalization | `editors/ExpressionInput.tsx` | Component test with mocked API shows errors inline |
| M10 | Default popover: presets per type, constant, custom | `editors/DefaultPopover.tsx`, `canvas/ColumnRow.tsx` | E2E: choose `now()` on a `timestamptz` column |
| M11 | FK by dragging between handles; FK edge popover | `canvas/Canvas.tsx`, `editors/FkPopover.tsx` | E2E: drag creates an FK; changing `ON DELETE` yields drop + add |
| M12 | Node footer with index editor | `canvas/NodeFooter.tsx`, `editors/IndexEditor.tsx` | E2E: add a composite unique index |
| M13 | Check constraint editor | `editors/CheckEditor.tsx`, `canvas/NodeFooter.tsx` | E2E: invalid check expression shows the Postgres error |
| M14 | Read-only objects: lock icon, no edit affordances | `canvas/TableNode.tsx`, `canvas/NodeFooter.tsx` | E2E: a partial index can't be edited |
| M15 | Validation errors shown on nodes | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | E2E: duplicate column name shows a red outline and message |

### N. Persistence and change detection

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| N1 | Drafts repository and channels | `store/drafts.ts`, `main/index.ts` | Save, read, clear by database key |
| N2 | Debounced draft saving; restore or discard on session start | `stores/persistence.ts`, `screens/Editor.tsx` | E2E: edits survive a restart; an external change while closed discards them with a notice |
| N3 | Fingerprint poller, `schema.fingerprint` channel, `schema:changed` event | `services/poller.ts`, `main/index.ts` | *DB*: an external `ALTER TABLE` emits the event within 5 s |
| N4 | Stale banner, reload with confirmation, stale flag | `chrome/StaleBanner.tsx`, `stores/schema.ts` | E2E: external change shows the banner; reload discards edits after confirming |
| N5 | Lost-connection detection and banner | `services/connection.ts`, `chrome/StaleBanner.tsx` | E2E: stopping the container shows the reconnect banner |

### O. SQL panel and validation

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| O1 | Top bar: database, change and risk counts, buttons with disabled states | `chrome/TopBar.tsx`, `screens/Editor.tsx` | Generate SQL disabled with no changes or validation errors |
| O2 | SQL panel with fingerprint pre-check and CodeMirror view | `sql/SqlPanel.tsx`, `sql/SqlView.tsx` | E2E: SQL appears; a stale schema blocks it |
| O3 | Risk summary | `sql/RiskSummary.tsx` | Component test: counts and expandable lists |
| O4 | Copy button | `sql/SqlPanel.tsx` | E2E: clipboard holds the SQL |
| O5 | Save via native dialog, filename pattern, last folder | `services/files.ts`, `store/settings.ts`, `main/index.ts` | Unit: filename format; the second save opens in the first save's folder |
| O6 | Validator service and `sql.validate` channel | `services/validator.ts`, `main/index.ts` | *DB*: `SET NOT NULL` on a column with nulls fails at the right statement; fingerprint unchanged after |
| O7 | Validate results and non-local host confirmation | `sql/ValidateResults.tsx`, `sql/SqlPanel.tsx` | E2E: results shown per statement; a non-local host asks first |

### P. Packaging and release

| # | Phase | Files | Test |
| --- | --- | --- | --- |
| P1 | `.deb` config, icon and desktop entry | `electron-builder.yml` | The built `.deb` installs on a clean Debian-based system and launches |
| P2 | CI packaging job with packaged-app smoke test | `ci.yml` | Packaged app opens the Connect screen and quits cleanly |
| P3 | README: install, usage, screenshots, architecture | `README.md` | Reviewed against a fresh install |
| P4 | Tag 0.1.0 and publish the GitHub Release | none | `.deb` downloadable from the release |

## Testing strategy

The round-trip property is the test that matters most: apply the generated migration to a database at state A, re-introspect, and the result must equal the edited state B.

| Layer | Tool | What it covers | Runs |
| --- | --- | --- | --- |
| Unit | Vitest | Quoting, type parsing, validation, diff per object kind, ordering, risk matrix, error mapping, stores | Every commit |
| Snapshot | Vitest | Rendered SQL per op kind and for full migrations; byte-identical output for identical input | Every commit |
| Database | Vitest + Testcontainers | Introspection, fingerprint, normalization, validator against real Postgres | Every commit, Postgres 14–18 in CI |
| Round trip | Vitest + Testcontainers | 20+ hand-written edit cases applied and re-introspected | Every commit |
| Property | `fast-check` | Random models and edits; every generated migration round-trips | 200 runs per commit, 2,000 nightly |
| Component | Vitest + React Testing Library | Editors, popovers, node rendering, risk summary | Every commit |
| End to end | Playwright `_electron` + a Postgres container | Connect, edit, generate, validate, persistence, change detection | Every commit |
| Packaged smoke | CI job on the built `.deb` | App launches and quits | Every release branch push |

**Round-trip comparison rules.** Models are compared by qualified names, not IDs (new objects get fresh OIDs). Expressions are compared after normalization. The comparison output lists the first differing object, so a failing property test points straight at the bug.

**Fixtures.** `core/test/fixtures/` holds SQL files that set up realistic schemas: two schemas with a cross-schema FK, enums, composite keys, a view, a trigger, a partial index, a `serial` column, an extension. Every introspection and E2E test starts from one of these.

**Determinism checks.** Generating SQL twice from the same diff must produce identical text, and the fingerprint must be identical across two reads with no DDL between them. Both are asserted directly.

## Risks and after 0.1.0

The biggest risk is a migration that silently does the wrong thing; most mitigations exist to make that impossible rather than unlikely.

| Risk | Mitigation |
| --- | --- |
| Generated SQL drops something it shouldn't | Read-only objects never produce ops; read-only guard blocks dependent drops; stale fingerprint blocks generation; round-trip and property tests |
| False changes from expression formatting | Expressions normalized by the connected database before diffing |
| Rename misread as drop + add | Stable OID-based IDs; renames tracked by identity |
| Introspection misses a catalog detail added later | Fingerprint coverage test; fixtures that include every modeled feature |
| Validate locks a busy table | `lock_timeout` 3 s, `statement_timeout` 30 s, explicit button, non-local confirmation |
| Catalog differences across Postgres versions | CI matrix 14–18 on every DB test |
| Canvas sluggish on large schemas | Text-only cells, single active input, compact nodes below 70% zoom, layout in a worker |
| Passwords stored weakly | Refuse to remember passwords when the keyring backend is `basic_text` |
| `better-sqlite3` breaks in the packaged app | Native rebuild in packaging; packaged smoke test in CI |
| Scope creep | Anything outside the goals list goes to the roadmap below |

### After 0.1.0

- **0.2:** undo/redo; impact numbers in warnings (rows affected, nulls, duplicates, table size estimate); rebase unsaved edits onto external changes.
- **0.3:** views and sequences as editable objects; partial and expression indexes; SSH tunnels.
- **0.4:** multiple databases per window; schema export as an image or documentation.
- **Later:** a CLI built from `packages/core` for CI drift checks; down migrations; more platforms and package formats.
