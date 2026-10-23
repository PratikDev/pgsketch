# pgsketch — Build Plan (0.1.0)

Oct 22, 2026 · @Pratik Dev

## Overview

pgsketch is a Linux desktop app that connects to a Postgres database, shows its schema as an editable diagram, and generates the migration SQL for whatever you change on the canvas. The user runs that SQL themselves; pgsketch never applies changes to a database.

The core loop is: connect → introspect → edit on the canvas → see the changes highlighted → generate SQL → optionally validate it with a dry run → copy or save it.

### Goals for 0.1.0

- Connect to a Postgres 14+ database with user-entered credentials, a connection string, or the local Unix socket, with an SSL mode for remote hosts.
- Introspect every non-system schema and render it as a diagram, filterable by schema.
- Edit tables, columns, types, defaults, keys, foreign keys (including self-references), indexes, check constraints and comments directly on the canvas, and create new schemas.
- Show pending changes on the diagram: added in green, modified in amber, removed in red with strikethrough.
- Generate an up-only plain SQL migration with risk warnings, wrapped in a transaction.
- Validate the migration with a `BEGIN … ROLLBACK` dry run on its own connection.
- Detect schema changes made outside the app: adopt them automatically when they match the user's edits (the user ran the SQL), otherwise block SQL generation until reload.
- Keep unsaved edits and diagram layouts across app restarts.

### Non-goals for 0.1.0

- Applying migrations to a database.
- Down migrations.
- Undo/redo.
- Rebasing unsaved edits onto unrelated external changes (reload discards them).
- Creating or editing enums. Existing enums are still usable as column types.
- Moving existing tables between schemas; renaming or dropping existing schemas.
- Turning identity on or off for existing columns.
- Views, functions, triggers, partitions, RLS policies, domains, sequences, and creating `serial` columns.
- Table search, a CLI, multiple open databases, and more than one app window.
- Packaging other than `.deb`; platforms other than Linux.

## Decisions

Every decision below is settled for 0.1.0; the rest of this plan builds on them.

| Area | Decision |
| --- | --- |
| Name | pgsketch |
| Platform | Linux; packaged as `.deb` only |
| Interface | GUI only, no CLI. Single app instance, one database per window |
| Connection | Optimistic: try to connect with what the user entered and turn failures into clear messages. Supports host/port, connection string, and the local Unix socket (peer auth, user defaulting to the OS username) |
| SSL | Mode selector with libpq meanings, built into explicit `pg` options and never passed through as `sslmode`: `disable`; `prefer` (try SSL, fall back to plaintext); `require` (encrypted, server not verified); `verify-full` (CA file and hostname verified). Defaults to `disable` for local hosts and sockets, `require` otherwise. A pasted connection string's `sslmode` fills the selector and is then stripped; the selector is the only source of truth |
| Saved connections | Opened by ID in the main process; passwords never reach the renderer. Forgetting a connection also deletes its drafts and layouts |
| `search_path` | Pinned to `''` on every connection whenever definitions are read, so introspected and normalized expressions are always fully qualified and identical across connections. Normalization parses user-typed expressions with the connection's original `search_path`, so unqualified names like `uuid_generate_v4()` resolve, then reads them back qualified |
| Source of truth | The live database. No project files |
| Postgres versions | 14 and newer. Postgres 18's `contype 'n'` NOT NULL rows in `pg_constraint` are handled explicitly |
| Schemas | All non-system schemas, never assuming `public`, with a schema filter on the canvas |
| Schema editing | Create new schemas only. A table's schema can change only while the table is a pending create; existing tables keep theirs. Renaming or dropping existing schemas and moving existing tables wait for 0.2 |
| Editable objects | Tables, columns, types, defaults, NOT NULL, primary keys, foreign keys (with `ON DELETE`/`ON UPDATE`, including self-references), unique and check constraints, plain B-tree indexes (single and composite), comments |
| Enums | Existing enums are read and usable as column types. Creating and editing enums waits for 0.2 |
| Identity | New tables start with an `id bigint GENERATED ALWAYS AS IDENTITY` primary key column. Toggling PK on any other column never changes its type or adds identity. `ALWAYS` vs `BY DEFAULT` is preserved on existing columns. Turning identity on or off for existing columns waits for 0.2 |
| Coupling rules | Turning PK on also turns NOT NULL on and locks it; turning PK off leaves NOT NULL on. Identity columns are always NOT NULL and can't have a default |
| Column removal | Removing a column also removes every constraint and index on its table that includes it, and every foreign key on other tables that references it. All are shown as removed and restored together. Read-only ones on the same table are included and listed as destructive; read-only dependents elsewhere block the removal. Table deletion follows the same rule |
| Read-only rule | Any object with an attribute pgsketch doesn't model is read-only: shown and preserved, never modified or recreated. It's dropped only as a visible consequence of deleting its own table or column, and then listed by name as destructive. If a read-only object elsewhere depends on what's being removed (a view, materialized view, policy, or read-only FK on another table), the removal is blocked. This covers partial, expression and non-B-tree indexes; DESC, INCLUDE, opclasses, storage options and `NULLS NOT DISTINCT` on indexes; deferrable, `NOT VALID`, `NO INHERIT` and `MATCH FULL` constraints; exclusion constraints; generated columns; `nextval(…)` defaults; partitioned tables and partitions. Objects of unmodeled kinds (views, materialized views, foreign tables, sequences, triggers, functions, policies) are kept in a separate `unmodeled` map |
| `serial` | Not created. Existing ones are preserved through the read-only rule |
| Editing | Directly on the canvas: inline cells, badges, anchored popovers, drag-to-relate. No side panel. No column reordering, since Postgres can't reorder existing columns |
| SQL in the UI | Only for custom default expressions and check constraints |
| Naming | New constraints and indexes use a port of Postgres's own algorithm: `t_pkey`, `t_a_b_key` (unique constraint), `t_a_b_fkey`, `t_a_check` (one column) or `t_check` (several), `t_a_b_idx` (index). Table and column parts are shortened separately to fit 63 bytes; collisions get a number (`t_a_key1`). Names of objects created in the editor are marked auto-generated and recomputed by a pure `assignNames` pass on every edit, so renaming a pending table or column renames its pending constraints and indexes too; naming one yourself fixes its name. Existing objects' names never change, including when their table is renamed |
| Change model | Diff between the loaded schema (baseline) and the edited schema (desired). Original names tracked by stable IDs so renames are exact |
| Undo/redo | Not in 0.1.0. Removed items stay visible and restorable until reload or until the change is adopted |
| Deleting a referenced table | Incoming foreign keys are shown as removed immediately; restoring the table restores them |
| Change detection | Schema fingerprint (definitions plus OIDs) polled every 5 s and on window focus against the last-seen value (used only to avoid duplicate notifications), taken inside the introspection snapshot. The Generate/Validate pre-check compares with the baseline's `loadedFingerprint` instead, and a failed handler marks the session stale. Every detected change, the Generate/Validate pre-check, and session start all run one handler: re-introspect, adopt (with "changes applied" and layout positions carried over by name) if the database matches the edits by qualified name, otherwise mark stale and block SQL generation and Validate. The handler decides and adopts in one synchronous step after the load returns, guarded by a version counter on `desired`, and waits while an inline editor is open, so edits made while it runs are never overwritten |
| Reload with unsaved edits | Discards the edits (after confirmation) |
| Unsaved edits across restarts | Kept if the fingerprint is unchanged and every OID-based ID in the draft still exists; otherwise the change handler decides between "changes applied" and discard |
| Output | Up-only plain SQL, wrapped in `BEGIN; … COMMIT;`. Deterministic: the timestamp and database name in the header are passed in, not generated |
| Type changes | `USING` is emitted only when no assignment conversion exists. Decided from all of `pg_cast` plus Postgres's rules for conversions it doesn't list: to string types needs no `USING`, from string types does, arrays follow their element types, domains their base type. Cast data is re-read fresh each time SQL is generated. Never emitted unconditionally, because explicit casts can truncate silently where assignment casts raise an error |
| Risk warnings | Summary panel plus a `-- WARNING` comment above each risky statement |
| Validate | Dry run on its own short-lived connection, inside `BEGIN … ROLLBACK`, with `lock_timeout`, one statement per extended-protocol message (`queryMode: 'extended'`, since `pg` otherwise uses the simple protocol), with the connection's original `search_path` so it predicts the user's own run. Warns first when the host isn't local |
| Expression normalization | On one reused task connection per window (closed after 30 s idle), with requests queued and each in its own `BEGIN … ROLLBACK`, using a temporary copy of the whole table and the same extended-protocol rule. Inputs normalize 400 ms after typing stops; results are cached. When temp tables aren't permitted, falls back to raw-text comparison with a warning, and creating or editing check constraints is disabled (defaults stay editable) |
| Connections per window | At most three: main, normalizer, and Validate |
| Delivery | Copy button, and Save via the native save dialog opening in the last-used folder |
| Diagram layout | Positions saved locally per database; auto-layout only on request. Positions for tables that no longer exist are pruned on load |
| Runtime | Node only (Electron's bundled Node; pnpm workspaces). `pg` pinned to an exact version, because `queryMode` is undocumented; upgrades must keep the protocol and SSL tests green. `better-sqlite3` for app data; `node:sqlite` to be revisited once stable |

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
2. If it differs from the baseline's `loadedFingerprint`, the change handler runs and generation stops; the panel regenerates from whatever state the handler leaves, which after an adopt is usually "no changes." If the handler fails, the session is marked stale.
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
  constraints: Record<Id, Constraint>; // pk | unique | check | fk | exclusion (always read-only)
  indexes: Record<Id, Index>;
  enums: Record<Id, EnumType>;          // read-only in 0.1.0, usable as types
  unmodeled: Record<Id, UnmodeledObject>; // views, matviews, foreign tables, sequences, triggers, functions, policies
}

interface Column {
  id: Id;
  tableId: Id;
  name: string;
  position: number;
  type: PgType;                 // { name, schema?, params?: number[], isArray }
  notNull: boolean;
  default: DefaultValue | null; // { kind: 'preset' | 'constant' | 'expression', ... }
  identity: 'always' | 'byDefault' | null;
  comment: string | null;
  readOnly?: ReadOnlyReason;    // set by the read-only rule, e.g. 'generated', 'nextval-default'
}

interface Constraint {
  id: Id;
  tableId: Id;
  kind: 'pk' | 'unique' | 'check' | 'fk' | 'exclusion';
  name: string;
  columnIds: Id[];              // for checks: the columns the expression references
  // ...kind-specific fields
  readOnly?: ReadOnlyReason;
}
```

Read-only is modeled one way per kind of object. Objects of a **modeled kind** (tables, columns, constraints, indexes, enums) live in their normal maps and carry the optional `readOnly` reason when introspection finds an attribute pgsketch doesn't model; an unsupported index is simply an index with a reason. Objects of an **unmodeled kind** live only in the `unmodeled` map, and are shown, linked to what they depend on, and never touched.

**Identity.** Objects loaded from the database get IDs derived from Postgres identifiers (`s:<namespace oid>`, `t:<table oid>`, `c:<table oid>:<attnum>`, `k:<constraint oid>`, `i:<index oid>`, `e:<type oid>`). These stay stable for the whole session and across reloads, as long as the object still exists. New objects created in the editor, schemas included, get a random UUID. Because a renamed column keeps its ID, the diff engine knows it's a rename, never a drop plus an add.

The flip side: once the user runs the migration, new objects get OIDs the editor never saw. So the question "does the database now match my edits?" is answered by comparing **qualified names**, not IDs (`diff/applied.ts`, used by change detection and the round-trip tests). The comparison covers every modeled kind, read-only objects included, by qualified name and definition, comparing column order rather than position numbers (Postgres keeps gaps where columns were dropped). Unmodeled objects (views, triggers and so on) are ignored: the user can't edit them, and adopting replaces the whole schema anyway, so an externally added view never blocks "changes applied."

**Two models.** The editor holds `baseline` (exactly what was introspected) and `desired` (baseline plus the user's edits). Removing something from the canvas deletes it from `desired` only. The diff is always `diff(baseline, desired)`.

### Model validation

Runs on `desired` before diffing. Errors block SQL generation and are shown on the offending node:

- Names are non-empty and at most 63 bytes (Postgres truncates longer identifiers silently).
- Name uniqueness follows Postgres's namespaces: tables, views, indexes and sequences share one namespace per schema, so an index can't share a table's name. Check, FK and NOT NULL constraint names must be unique per table. PK and unique constraint names also create an index, so they must be unique in the schema's relation namespace too.
- Every table has at most one primary key.
- Constraints and indexes reference only columns that exist in `desired`.
- Primary key columns are NOT NULL. Identity columns are NOT NULL and have no default.
- A foreign key references columns covered by a primary key, a unique constraint, or a non-partial, non-expression, non-deferrable unique index, with the same number of columns and compatible types. Self-references are allowed.
- Type parameters are valid (`varchar` length > 0, `numeric` scale ≤ precision).
- Defaults are compatible with the column type (presets are filtered by type; custom expressions are checked during normalization).
- A pending table's schema either exists or is being created in the same migration.

The editor enforces the coupling and cascade rules as you edit; these checks are a backstop that blocks generation if something slips through.

**Auto-names.** Constraints and indexes created in the editor carry `autoName: true`. Before validation and diffing, a pure `assignNames(desired)` pass recomputes every auto-name with `model/naming.ts`, in a fixed order so collision numbers are deterministic. Renaming a pending table or column therefore renames its pending constraints and indexes too. Naming an object yourself sets `autoName: false`. Names of objects loaded from the database are never recomputed.

### Introspection

Handwritten queries against `pg_catalog`, one per object kind, run inside a single `REPEATABLE READ` read-only transaction so all results describe the same moment:

| Query | Source catalogs | Captures |
| --- | --- | --- |
| Schemas | `pg_namespace` | All except `pg_catalog`, `information_schema`, `pg_toast*`, `pg_temp*` |
| Tables | `pg_class` (`relkind = 'r'`), `obj_description` | Name, schema, comment. Partitioned tables (`'p'`) and partitions (`relispartition`) are read-only |
| Columns | `pg_attribute`, `pg_attrdef`, `format_type`, `pg_get_expr`, `col_description` | Name, position, type, NOT NULL, default, identity kind (`attidentity`), generated flag (`attgenerated`, read-only), comment |
| Constraints | `pg_constraint`, `pg_get_constraintdef` | PK, unique, check (with referenced columns from `conkey`), FK (actions, match type), deferrable, validated, no-inherit. Exclusion constraints (`'x'`) become `kind: 'exclusion'`, always read-only. Postgres 18 NOT NULL rows (`'n'`) are excluded here; NOT NULL comes from `attnotnull`, and a `NOT VALID` or `NO INHERIT` NOT NULL makes the column read-only |
| Indexes | `pg_index`, `pg_class`, `pg_am`, `pg_get_indexdef` | Columns, uniqueness, method, predicate, expressions, sort order and nulls order (`indoption`), INCLUDE columns, opclasses, storage options, `NULLS NOT DISTINCT` (15+) |
| Enums | `pg_type` (`typtype = 'e'`), `pg_enum` ordered by `enumsortorder` | Name, labels in order (read-only) |
| Unmodeled objects | `pg_class` (views, materialized views, foreign tables, sequences), `pg_trigger`, `pg_proc`, `pg_policy`, `pg_depend`, `pg_rewrite` | Name, kind, and which tables and columns depend on them |
| Casts | `pg_cast` (all rows), `pg_type` (category, element type, base type) | Everything the coercion rules need to decide whether a type change needs `USING`, including for types the user picks later. Read at load and again each time SQL is generated; not part of the fingerprint |

Objects owned by extensions (found through `pg_depend` with `deptype = 'e'`) are excluded entirely, so installing an extension never makes its internal tables appear on the canvas.

Classification follows the read-only rule: an object is editable only if every attribute it has is one pgsketch models. A unique B-tree index on plain ascending columns is editable; add a `WHERE` clause, an expression, `DESC`, `INCLUDE`, a non-default opclass or storage option, or `NULLS NOT DISTINCT`, and it becomes read-only. The same applies to constraints and columns. Without this rule, a drop + add of a changed object would silently lose those attributes. Index entries that merely back a PK or unique constraint are folded into that constraint, not shown twice.

The model, the cast data and the fingerprint are all read inside the same snapshot transaction, so the fingerprint describes exactly the schema that was loaded. Every connection runs with `search_path = ''`, so `pg_get_expr` and `format_type` always return fully schema-qualified names, identical between the main connection and task connections.

**Coercion rules** (`sql/coercion.ts`) decide whether `ALTER COLUMN TYPE` needs `USING`, i.e. whether an assignment conversion exists: the same type with different length or precision needs none; any type to a string type (category `S`) needs none, since Postgres's automatic conversions to string types count as assignment casts; a string type to anything else needs `USING`, since those are explicit-only; arrays follow their element types; domains follow their base type; everything else uses `pg_cast` (`castcontext` `a` or `i` means no `USING`).

### Fingerprint

One query that hashes **selected columns** of the catalogs into a single value, covering exactly the objects introspection reads (including read-only and unmodeled ones). It hashes definitions (names, types, flags, expression and definition text) **and the OIDs of schemas, tables, columns, constraints, indexes and types**. OIDs don't change on `VACUUM`, `ANALYZE`, `VACUUM FULL` or `TRUNCATE`, but they do change when a table is dropped and recreated or a database is restored from a dump; without them, an identical-looking schema with new OIDs would pass the fingerprint while every ID in a saved draft pointed at nothing. For unmodeled objects it hashes only OID, name, kind and dependencies, which is all the app uses them for: editing a function body or a policy doesn't flip it, but a view whose dependencies change does. Cast data isn't fingerprinted at all; it's re-read fresh every time SQL is generated. It never hashes statistics or housekeeping columns such as `reltuples`, `relpages` or `relfrozenxid`, which change on `VACUUM`, `ANALYZE` and autovacuum and would cause false stale banners.

A coverage test keeps the fingerprint and introspection in sync: it reads the list of catalog **tables** from the test database (`pg_class` rows in `pg_catalog` with `relkind = 'r'`), finds which of them the introspection SQL reads, and fails if the fingerprint doesn't cover each one. Matching against real catalog table names avoids false hits on functions like `pg_get_expr`. The cast queries are explicitly excluded from the check.

### Diff engine

`diff(baseline, desired): ChangeOp[]` compares objects by ID:

- In `desired` only → create.
- In `baseline` only → drop. Because the editor cascades removals, everything that depends on a removed table or column (constraints and indexes on the same table, and foreign keys on other tables) is already gone from `desired`, so each gets an explicit drop instead of being dropped silently by Postgres. As a backstop, the diff still drops any FK that points at a dropped table or column.
- In both → compare field by field and emit one operation per changed property (rename, type change, nullability, default, comment...).
- An existing table whose schema differs → a blocking error. The UI never allows this, so it signals a bug.
- Read-only objects are never modified or recreated. They're dropped only when their own table or column is removed, as an explicit drop flagged destructive. Anything that would require dropping a read-only object outside that table (a view on the column, a read-only FK on another table, a policy) is a blocking error rather than generated.
- When both sides of a foreign key change type in the same migration and the in-between state would be incompatible (no equality operator between the old and new types), the FK is dropped before and re-added after. In every other case Postgres rebuilds the FK itself during `ALTER COLUMN TYPE`.

```ts
type ChangeOp =
  | { kind: 'createSchema'; schema: Schema }
  | { kind: 'createTable'; table: Table; columns: Column[]; pk?: Constraint }
  | { kind: 'renameTable'; tableId: Id; from: string; to: string }
  | { kind: 'dropTable'; table: Table }
  | { kind: 'addColumn'; column: Column }        // may include identity on new columns
  | { kind: 'renameColumn'; columnId: Id; from: string; to: string }
  | { kind: 'alterColumnType'; columnId: Id; from: PgType; to: PgType }
  | { kind: 'setNotNull' | 'dropNotNull'; columnId: Id }
  | { kind: 'setDefault'; columnId: Id; to: DefaultValue }
  | { kind: 'dropDefault'; columnId: Id }
  | { kind: 'dropColumn'; column: Column }
  | { kind: 'addConstraint'; constraint: Constraint }
  | { kind: 'renameConstraint'; constraintId: Id; from: string; to: string }
  | { kind: 'dropConstraint'; constraint: Constraint }
  | { kind: 'addIndex'; index: Index }
  | { kind: 'renameIndex'; indexId: Id; from: string; to: string }
  | { kind: 'dropIndex'; index: Index }
  | { kind: 'setComment'; target: CommentTarget; to: string | null };
```

There are no enum, schema-rename, table-move or identity-toggle operations in 0.1.0, because the editor can't produce those changes. Identity on a **new** column is part of `addColumn` or `createTable`.

A changed constraint or index (different columns or actions) is expressed as drop + add, since Postgres can't alter them in place. A renamed constraint or index uses `renameConstraint` / `renameIndex`.

### Operation ordering

The renderer sorts operations into fixed phases so every statement's dependencies exist when it runs:

1. Create schemas.
2. Drop foreign keys that are dropped or changed, that point at a table or column being dropped, or that fall under the incompatible type-change rule.
3. Drop other constraints and indexes that are dropped or changed.
4. Renames: tables, columns, constraints, indexes.
5. Create tables (with columns and primary key, without foreign keys).
6. Add columns.
7. Alter columns: type, defaults, nullability.
8. Drop columns.
9. Drop tables.
10. Add constraints and indexes (non-FK).
11. Add foreign keys.
12. Comments.

Within a phase, operations are sorted by qualified name, so the same changes always produce byte-identical SQL. That determinism is what makes snapshot tests reliable. Table drops in phase 9 need no dependency ordering: every foreign key pointing at a dropped table was already dropped in phase 2. All statements run inside the transaction; 0.1.0 has no statements that must run outside it.

### Risk classification

`assessRisk(op, baseline): Risk[]` returns zero or more risks, each with a level and a human-readable message:

| Level | Operations |
| --- | --- |
| Destructive (data lost) | `dropTable`, `dropColumn`, lossy type changes, and read-only objects dropped with their own table or column (listed by name) |
| May fail (depends on data) | `setNotNull`; `addColumn` with NOT NULL and no default on an existing table; adding unique, check or FK constraints; PK changes; type changes that need a cast |
| Breaks app code | `renameTable`, `renameColumn` |
| Locks or slow on large tables | Type changes that rewrite the table; `setNotNull` and constraint additions that scan it; `addIndex`, which blocks writes for its whole duration (`CONCURRENTLY` can't run inside the transaction) |
| Safe | Everything else |

Type changes go through a lookup table with two lists: known-safe widenings (`smallint → integer → bigint`, `varchar(n) → varchar(m > n)`, `varchar → text`, larger `numeric` precision with the same scale) and known-lossy conversions (`numeric` scale decrease, `float → integer`, `timestamp(tz) → date`, `text → varchar(n)`). Anything in neither list is treated as **may fail**. Unknown cases default to a warning, never to safe.

### SQL rendering

`render(ops, risks, context)` produces the migration text and its statement array:

- Signature: `render(ops, risks, context)`, where `context` holds `generatedAt`, `dbName` and the cast data. `render` never reads the clock or the database, so the same inputs always give the same text.
- Every identifier goes through `quoteIdent` (always double-quoted, embedded quotes doubled) and every literal through `quoteLiteral`. No string concatenation of names anywhere else.
- Every object is schema-qualified: `"billing"."invoices"`.
- Type changes add `USING "col"::newtype` only when the coercion rules find no assignment conversion. Emitting it always would be wrong: an explicit cast to `varchar(n)` truncates over-length values silently, while the assignment cast raises an error.
- New constraints and indexes are named by `model/naming.ts`, a port of Postgres's `makeObjectName` (the longer of the table and column parts is shortened first until the name fits 63 bytes) and its numbered collision handling, checked against the desired model's namespaces.
- Header comment: generated by pgsketch, `generatedAt`, `dbName`, operation and risk counts.
- Each risky statement is preceded by `-- WARNING (<level>): <message>`.
- All statements are wrapped in `BEGIN;` / `COMMIT;`.

### Expression normalization

Postgres stores defaults and check expressions in a normalized form (`CURRENT_TIMESTAMP` comes back differently than typed, `'active'` comes back as `'active'::text`). Comparing raw text would produce false changes.

`normalizeExpression(query, expr, context)` asks the connected database for the canonical form, on the normalizer's own task connection so it can never interfere with another transaction. `context` carries the target table's full column list (existing and pending), so expressions that reference other columns, like `end_date > start_date`, can be normalized, plus the connection's original `search_path`, read once at connect time before it was pinned:

1. `BEGIN`.
2. `SET LOCAL search_path` to the connection's original value, so unqualified names the user typed (such as `uuid_generate_v4()` from an extension installed in `public`) resolve as they would in their own session.
3. Create a temporary table with a copy of every column of the target table, plus the expression as a default (or as a check constraint).
4. `SET LOCAL search_path = ''`, then read the expression back with `pg_get_expr` (or `pg_get_constraintdef`). Names were bound when the table was created, so the output comes back fully qualified (`public.uuid_generate_v4()`).
5. `ROLLBACK`.

If a name still doesn't resolve, the error shown on the input suggests schema-qualifying it.

Each statement goes through `runSingle(client, sql)`, which always passes `queryMode: 'extended'`. That matters: `pg` only uses the extended protocol when a query has parameter values or this option is set, and an empty values array falls back to the simple protocol, which accepts several statements. Under the extended protocol Postgres accepts exactly one statement per message, so a malicious or mistyped expression like `1); COMMIT; DROP TABLE …` fails with a syntax error instead of executing.

For check constraints, step 4 also reads the temporary constraint's `conkey`, which gives the columns the expression references. That's how the editor knows which checks to remove along with a column.

The desired model stores only normalized expressions, so the diff compares like with like. A syntax or type error at step 3 is shown on the input as a validation error, which doubles as live checking for custom expressions. Presets (`now()`, `gen_random_uuid()`, constants) are normalized the same way once per session and cached.

If the role can't create temporary tables (TEMP privilege revoked, or a read-only replica), normalization falls back to comparing raw text, and the app shows a one-time warning that expression changes may appear as false differences. In that mode, creating or editing check constraints is disabled with an explanation, because without the temporary constraint there's no reliable list of the columns a check references, which the removal cascade and validation depend on. Existing checks keep working, since introspection supplies their columns, and custom defaults stay editable.

**Cost:** expression inputs normalize 400 ms after typing stops, and results are cached per expression and table context. The normalizer reuses one task connection per window, closes it after 30 seconds idle, and queues requests on it.

## Desktop app design

The main process owns everything with side effects (the database connection, local storage, files, keyring); the renderer owns the editor and calls the main process only through a typed preload API.

### Main process services

| Service | Responsibility |
| --- | --- |
| Connection manager | Holds the **main connection** (one `pg.Client` per window) used only for introspection and fingerprint polling, with queries serialized so they never interleave. Builds explicit SSL options from the selected mode (including the `prefer` fallback), records the original `search_path` and then pins it to `''`, checks the version, maps errors, and sets `application_name = 'pgsketch'` |
| Task connections | Separate connections with the same settings, never shared with an open transaction: Validate opens a short-lived one per run; the normalizer reuses one per window, closed after 30 seconds idle. With the main connection, that's at most three per window |
| `runSingle` | Executes one statement with `queryMode: 'extended'`; the only way user-influenced SQL reaches a task connection |
| Introspector | Runs the core introspection in a read-only snapshot and returns `{ model, casts, fingerprint }` |
| Fingerprint poller | Every 5 s while connected, and on window focus. Compares with the **last-seen** fingerprint and pushes `schema:changed` only when it differs, so a stale session isn't re-notified every 5 s |
| Normalizer | Runs core `normalizeExpression` on its reused task connection, queuing requests, with a per-session cache |
| Validator | Runs the dry run on its own task connection (see Validate flow) |
| App store | `better-sqlite3` database for connections, drafts, layouts and settings |
| Secrets | Encrypts and decrypts passwords with `safeStorage`. Checks the keyring backend only after the app's `ready` event, since it reports `unknown` before then, and treats `unknown` like `basic_text` |
| File service | Native save dialog, remembers the last folder, writes the `.sql` file |
| Instance lock | `app.requestSingleInstanceLock()`; a second launch focuses the existing window |

### IPC API

Every channel has a zod schema for its input, validated in the main process before anything runs.

| Channel | Input | Returns |
| --- | --- | --- |
| `connection.defaults` | none | OS username, socket path |
| `connection.test` | Connection params | OK or a mapped error |
| `connection.open` | Connection params, remember flag | Session info (server version, database, host kind, `dbKey`) |
| `connection.openSaved` | Saved connection ID | Session info; the password is decrypted in main and never sent to the renderer |
| `connection.close` | none | none |
| `connection.recent` | none | Saved connections without passwords |
| `connection.forget` | Connection ID | none; also deletes that connection's drafts and layouts |
| `schema.load` | none | `{ model, casts, fingerprint }` |
| `schema.fingerprint` | none | Current fingerprint. A sibling channel, `schema.casts`, returns fresh cast data for SQL generation |
| `expr.normalize` | Expression, kind (default or check), target type, table context | Normalized text plus, for checks, the referenced column IDs; or an error; or a fallback notice (in which case check editing is disabled) |
| `sql.validate` | Statements, expected fingerprint | Per-statement results |
| `sql.save` | SQL text, suggested filename | Saved path, or cancelled |
| `draft.get` / `draft.put` / `draft.clear` | `dbKey`, draft | Draft |
| `layout.get` / `layout.put` | `dbKey`, positions | Positions |

Handlers live in one file per domain (`main/ipc/connection.ts`, `schema.ts`, `expr.ts`, `sql.ts`, `drafts.ts`, `layouts.ts`, `files.ts`), so adding a channel never touches a central file beyond a one-line registration.

Events from main to renderer: `schema:changed`, `connection:lost`.

### Connection screen

- Fields: host (default `localhost`), port (`5432`), user (`postgres`), password, database, SSL mode. A toggle switches to a single connection-string field. A "Local socket" option sets the host to `/var/run/postgresql`, clears the password, and sets the user to the OS username, since peer authentication matches the OS user.
- SSL mode, with libpq meanings: `disable`; `prefer` (try SSL, fall back to plaintext if the server refuses it); `require` (encrypted, but the server isn't verified, which the form notes); `verify-full` (asks for a CA certificate file and verifies the certificate and hostname). Defaults to `disable` for local hosts and sockets and `require` for anything else. The app builds `pg`'s `ssl` option itself and never passes `sslmode` to `pg`, whose parser currently treats the weaker modes as `verify-full` and plans to change that.
- A pasted connection string is parsed into fields; its `sslmode`, if any, sets the selector and is removed from the string. From then on, the selector alone decides.
- "Remember" saves the connection; the password is stored encrypted, separately.
- Recent connections are listed above the form; clicking one calls `connection.openSaved` with its ID.
- Errors are mapped from driver errors:

| Signal | Message |
| --- | --- |
| `ECONNREFUSED` | Couldn't reach Postgres at host:port. Is it running? |
| `ENOTFOUND` | Host not found |
| Timeout (5 s) | Connection timed out |
| `28P01` | Password authentication failed for user |
| `28000` | Authentication rejected (check `pg_hba.conf` or the peer auth user) |
| `3D000` | Database doesn't exist on this server |
| Server refuses SSL | The server doesn't accept SSL connections; choose `disable` or `prefer` |
| Certificate errors | The server's certificate couldn't be verified with the given CA file |
| Server version < 14 | pgsketch needs Postgres 14 or newer (found X) |

### Session start

1. Connect and check the server version.
2. Compute the `dbKey`: the saved connection ID plus database name, or for unsaved connections a hash of host, port, user and database.
3. `schema.load`: baseline model, cast data and fingerprint, all from one snapshot.
4. Load the saved draft for this `dbKey`. Restore it as `desired` only if its stored fingerprint equals the current one **and** every OID-based ID in it exists in the baseline. Otherwise run the change handler (below): if the database matches the draft by qualified name, show "Changes applied" and clear the draft; if not, discard it with a one-line notice.
5. Load saved layout positions (after any remap the handler did), and prune rows for tables that no longer exist. Tables without a position are placed by auto-layout.
6. Start the fingerprint poller.

### Editor state

Zustand stores, normalized, no Immer to start:

- **Schema store**, split into slices so no file grows unbounded: `core` (`baseline`, `desired`, `loadedFingerprint`, `stale`, load, adopt, restore, the change handler), `tables`, `columns`, `constraints` (including FKs and indexes) and `schemas`. Each action edits `desired` only and increments its version counter.
- **New tables** start with an `id bigint GENERATED ALWAYS AS IDENTITY` primary key column.
- **Coupling rules in the actions:** turning PK on turns NOT NULL on (and turning PK off leaves it on); identity columns keep NOT NULL and can't take a default. Toggling PK never changes a column's type or adds identity.
- **Cascade on column removal:** removing a column also marks as removed every constraint and index on that table that includes it, and every foreign key on other tables that references it. Restoring the column restores them all. Read-only ones on the same table are included; if a read-only object elsewhere depends on the column, the removal is refused with a message naming it. Table deletion follows the same rule.
- Derived diff: a memoized selector runs `assignNames`, then computes `diff(baseline, desired)`, `assessRisk` and validation errors whenever `desired` changes. From the ops it builds a status map: `id → 'added' | 'modified' | 'removed'` plus old values for hover.
- **UI store:** selection, the cell being edited, open popover, zoom level, schema filter, whether normalization is in fallback mode.
- **Layout store:** node positions; saved to the app store debounced by 500 ms.
- **Draft persistence:** `desired` + `loadedFingerprint` saved debounced by 1 s, keyed by `dbKey`.

### Canvas

The canvas renders the **union** of `baseline` and `desired`: removed objects come from `baseline` and are drawn struck through in red, so they can be restored with a click (restore copies the object back from `baseline` into `desired`).

**Table node:**

- Header: `schema.table`. Double-click the name to rename. For a pending (new) table, the schema part is a dropdown listing existing schemas plus "New schema…"; for an existing table it's plain text. Hover or selection shows a toolbar (`NodeToolbar`): add column, add index, add check, comment, delete table.
- Column rows: name · type · badges (PK, NN, UQ) · default chip (`= now()`) · FK target (`→ orgs.id`). A connection handle on each row's left and right edge.
- Footer: "N indexes · M checks", expands inline, next to a badge for unmodeled objects attached to the table ("2 views · 1 trigger") that lists their names on hover. Sequences behind identity or `serial` columns are represented by the column itself; standalone objects not tied to any table aren't shown in 0.1.0, but appear by name in blocking messages.
- New table: double-click empty canvas. It lands in the schema currently selected in the schema filter, or `public` if all are shown and it exists, otherwise the first schema. It starts with an `id bigint` identity primary key column.

**Editing interactions:**

| Target | Interaction |
| --- | --- |
| Table or column name | Click → inline input. Enter/Tab commits, Esc cancels |
| Schema (pending tables only) | Click → dropdown of schemas plus "New schema…", which creates a pending schema |
| Type | Click → searchable picker popover (built-in types plus existing enums); parameter inputs for `varchar`, `numeric`, etc.; array toggle |
| PK / NN / UQ | Click badge to toggle (faded when off). NN is locked on while PK is on, and on identity columns |
| Default | Click chip → presets for the type, constant value, custom expression. Disabled on identity columns |
| Row actions | Hover `⋯` → comment, delete. Deleting a column also marks the constraints and indexes that include it, and FKs on other tables that reference it, as removed |
| Table and column comments | Toolbar or row menu → small popover with a text field |
| Foreign key | Drag from a column's handle to a column in any table, including the same table (self-reference) |
| FK edge | Click → popover with `ON DELETE`, `ON UPDATE`, remove |
| Index | Footer → pick columns in order, toggle unique |
| Check constraint | Footer → expression input (normalized 400 ms after typing stops). Disabled with an explanation when normalization is in fallback mode |
| Keyboard | Tab moves name → type → next row; Enter on last row adds a column |

**Rendering rules:**

- Cells render plain text; only the cell being edited mounts an input.
- Inputs carry `nodrag nopan`; Delete/Backspace never remove nodes while an input has focus.
- Popovers render in a portal outside the zoomed viewport, positioned with Floating UI (via Radix).
- Below 70% zoom, nodes render in a simplified form (table name and column count only), and clicking one zooms to it before editing.
- FK edges are custom SVG edges with crow's-foot markers for one-to-many; a self-referencing FK draws as a loop on the node's side.
- The schema filter hides tables in deselected schemas; FK edges to hidden tables end in a small stub labeled with the target table.
- Auto-layout (`elkjs` in a worker, one port per column) runs only from the "Auto-arrange" button or for tables without a saved position.

**Diff highlighting:**

| Status | Style |
| --- | --- |
| Added | Green left border and tint |
| Modified | Amber; hover shows the old value (`varchar(100) → varchar(255)`) |
| Removed | Red, struck through, faded; click to restore. Deleting a table also shows its incoming FK edges as removed, and restoring the table restores them |
| Validation error | Red outline with the message on hover |
| Read-only | Grey, lock icon, no edit affordances; hover shows why ("partial index", "generated column"...) |

### Top bar

Database name and host, the schema filter, a change counter ("5 changes · 1 destructive"), **Generate SQL**, **Reload**, **Auto-arrange**, and **Disconnect**. Generate SQL is disabled while there are validation errors or no changes.

### Change detection flow

One handler, `onSchemaChanged`, runs in three situations: the poller reports a new fingerprint, the Generate/Validate pre-check finds a different fingerprint, or session start finds a draft that can't be restored as-is.

1. Re-introspect with `schema.load` (without replacing anything yet). Everything below is decided only after the load returns: whether there are unsaved edits, the comparison and the adopt happen in one synchronous step with no `await` in between, and async work (saving layouts, clearing the draft) runs after the adopt. As a guard, `desired` has a version counter that every edit increments; the handler records it when the load returns and checks it again just before adopting, re-running the comparison against the already-fetched schema if it moved. While an inline input or popover is open, an adopt waits; when the editor commits or cancels, the comparison re-runs, so typed but uncommitted text is never lost.
2. If there are unsaved edits and the new schema matches `desired` by qualified name (core `diff/applied.ts`), the user ran the SQL: adopt the new schema as both baseline and desired, move layout positions from old IDs to the new IDs of tables with the same qualified name, clear the draft, and show "Changes applied."
3. If there are no unsaved edits, adopt the new schema silently.
4. Otherwise set `stale = true` and show the banner: "The database schema changed outside pgsketch." with **Reload**, which asks "Reload and discard N unsaved changes?".
5. While stale, Generate SQL and Validate are disabled with an explanation. Each further change reported by the poller runs the handler again, so finishing a partial manual apply recovers automatically.
6. Generate SQL and Validate always call `schema.fingerprint` first and compare it with the baseline's `loadedFingerprint`, never with the poller's last-seen value, which only prevents duplicate notifications. `loadedFingerprint` changes only when a load or adopt succeeds, so correctness never depends on poll timing. If the handler fails for any reason (for example, `schema.load` throws), the session is marked stale. Failures block generation; they never allow it.

### SQL panel

A bottom drawer opened by Generate SQL:

- Risk summary: counts per level, each expandable to its list.
- The SQL in a read-only CodeMirror view with PostgreSQL highlighting.
- **Copy**, **Save** (native dialog, suggested name `YYYYMMDD_HHmmss_pgsketch.sql`, opens in the last-used folder), **Validate**.
- The panel regenerates when `desired` changes while it's open.

### Validate flow

1. Re-check the fingerprint against `loadedFingerprint`. If it differs, run `onSchemaChanged` and stop: the statements were generated for the old schema, and the SQL panel regenerates from the new state.
2. If the host isn't local (`localhost`, `127.0.0.1`, `::1`, or a socket path), confirm first: it takes locks on that server.
3. Open a task connection. `BEGIN`, `SET LOCAL lock_timeout = '3s'`, `SET LOCAL statement_timeout = '30s'`, and `SET LOCAL search_path` to the connection's original value, so the dry run behaves like the user's own run.
4. Run the statements one at a time through `runSingle`, recording each result and stopping at the first error. A statement can't smuggle in a `COMMIT`, because extended-protocol messages accept only one statement.
5. `ROLLBACK` always, in a `finally`, then close the task connection.
6. Show results next to each statement: passed, failed (with the Postgres error and code), or not run.

Because Validate never touches the main connection, the poller can't see its uncommitted DDL, and nothing else can end its transaction early.

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
  url           TEXT,                    -- url kind only, password removed
  ssl_mode      TEXT NOT NULL,           -- disable | prefer | require | verify-full
  ssl_ca_path   TEXT,                    -- verify-full only
  password_enc  BLOB,                    -- safeStorage ciphertext, null if none
  last_used_at  INTEGER NOT NULL
);

CREATE TABLE drafts (
  db_key        TEXT PRIMARY KEY,
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

`db_key` identifies one database for drafts and layouts: the saved connection ID plus the database name, or, for connections that aren't remembered, a hash of host, port, user and database. Connection-string connections store the URL in `url` with the password removed; the password goes into `password_enc`. Migrations use numbered `.sql` files tracked with `PRAGMA user_version`. Pragmas at open: `journal_mode = WAL`, `foreign_keys = ON`.

All app paths come from one data directory, which the `PGSKETCH_DATA_DIR` environment variable overrides. It's read at startup before anything else and also sets Electron's user-data folder, which the single-instance lock is scoped to. Each E2E test gets its own temporary directory, so parallel runs and restart tests don't collide.

### Security baseline

- Renderer: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Strict CSP: bundled scripts only, no inline scripts, no remote resources.
- Preload exposes only the typed API from the IPC table; never raw `ipcRenderer`.
- Every IPC input validated with zod in the main process.
- Passwords: `safeStorage` (libsecret on Linux). If the keyring backend is unavailable, `safeStorage` falls back to a weak hardcoded key on Linux, so the app checks `safeStorage.getSelectedStorageBackend()` and refuses to remember passwords when it reports `basic_text` or `unknown`. The check runs only after the app's `ready` event, because the function returns `unknown` before then. Saved connections are opened by ID, so passwords never cross IPC.
- All SQL built through `quoteIdent` and `quoteLiteral`; user values sent to `pg` as parameters wherever possible.
- Statements that embed user-written expressions (normalization, Validate) are sent one per extended-protocol message, so an expression can't append extra statements such as `COMMIT`.
- Transactions never share a connection with other work: Validate and normalization use task connections.
- Database object names and comments are rendered as React text, never as HTML.
- Logs never contain passwords or full connection strings.
- A single app instance, so two windows can't overwrite each other's drafts.

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
| State | Zustand, normalized, split into slices (Immer only if needed later) | Editor stores |
| Canvas | React Flow (`@xyflow/react`) | Nodes, handles, edges, node toolbar |
| Layout | `elkjs` in a web worker | Auto-arrange with per-column ports |
| Positioning | Radix Popover (Floating UI) | Portaled popovers |
| SQL view | CodeMirror 6 + `@codemirror/lang-sql` | SQL preview, expression inputs |
| Postgres | `pg` (node-postgres) | Main and task connections, SSL, introspection, validate. Pinned to an exact version, since `queryMode` is undocumented |
| Validation | zod | IPC inputs, connection forms |
| App data | `better-sqlite3` (`node:sqlite` to be revisited once stable) | Connections, drafts, layouts, settings |
| Secrets | Electron `safeStorage` | Passwords |
| Unit tests | Vitest | Core logic, stores |
| Component tests | Vitest + React Testing Library + jsdom | Renderer components |
| DB tests | Testcontainers (`@testcontainers/postgresql`) | Real Postgres 14–18 |
| Property tests | `fast-check` | Diff round trips |
| E2E | Playwright `_electron` | Full app flows |
| Packaging | `electron-builder` (`deb`) | Release |
| CI | GitHub Actions | Lint, tests, PG version matrix, nightly property run, package |

### Repository structure

Files are deliberately small and single-purpose, so each build phase touches only a few of them.

```text
pgsketch/
  package.json · pnpm-workspace.yaml · tsconfig.base.json
  .github/workflows/  ci.yml · nightly.yml
  packages/core/
    src/
      model/        types.ts · ids.ts · validate.ts · naming.ts
      sql/          quote.ts · pgtype.ts · coercion.ts
      introspect/   query.ts (Query type, snapshot helper) · schemas.ts · tables.ts · columns.ts
                    constraints.ts · indexes.ts · enums.ts · unmodeled.ts · extensions.ts
                    casts.ts · index.ts
      fingerprint/  fingerprint.ts
      diff/         ops.ts · schemas.ts · tables.ts · columns.ts · constraints.ts · indexes.ts
                    comments.ts · readonly-guard.ts · fk-type-changes.ts · applied.ts · index.ts
      order/        order.ts
      risk/         type-changes.ts · assess.ts
      render/       schemas.ts · tables.ts · columns.ts · constraints.ts · indexes.ts
                    comments.ts · migration.ts
      normalize/    expression.ts
      index.ts
    test/           pg.ts (container helper) · roundtrip.ts · arbitraries.ts · fixtures/
  apps/desktop/
    vitest.config.ts · playwright.config.ts · electron-builder.yml
    src/
      shared/       ipc-contract.ts
      main/         index.ts · paths.ts · window.ts · log.ts
        ipc/        register.ts · index.ts · connection.ts · schema.ts · expr.ts · sql.ts
                    drafts.ts · layouts.ts · files.ts
        services/   connection.ts · ssl.ts · task-connection.ts · run-single.ts · errors.ts
                    introspector.ts · poller.ts · normalizer.ts · validator.ts · secrets.ts · files.ts
        store/      db.ts · migrations/001_init.sql · connections.ts · drafts.ts · layouts.ts · settings.ts
      preload/      index.ts
      renderer/
        main.tsx · App.tsx · api.ts · test-setup.ts
        screens/    Connect.tsx · Editor.tsx
        stores/     schema/ (core.ts · tables.ts · columns.ts · constraints.ts · schemas.ts)
                    ui.ts · layout.ts · derived.ts · persistence.ts
        canvas/     Canvas.tsx · TableNode.tsx · ColumnRow.tsx · NodeFooter.tsx · TableToolbar.tsx
                    FkEdge.tsx · CompactNode.tsx · status.ts
        editors/    InlineText.tsx · TypePicker.tsx · DefaultPopover.tsx · FkPopover.tsx
                    IndexEditor.tsx · CheckEditor.tsx · ExpressionInput.tsx · SchemaPicker.tsx
                    CommentPopover.tsx
        layout/     elk.worker.ts · autoLayout.ts
        chrome/     TopBar.tsx · StaleBanner.tsx · SchemaFilter.tsx
        sql/        SqlPanel.tsx · RiskSummary.tsx · SqlView.tsx · ValidateResults.tsx
    e2e/            *.spec.ts
```

## Build phases

The build is 121 thin phases in 16 milestones; each phase changes at most three source files and ends with a passing test and a commit.

**Rules for every phase:**

- The **Files** column lists source files created or changed. Each phase also adds or updates its own test file, which isn't counted. Setup phases that run generators (marked *generated*) are the only exception to the file limit.
- A phase is done when its **Test** passes locally and in CI. Never start the next phase on a red build.
- Core milestones (B–H) need no UI and come first: by the end of H, the whole schema-to-SQL pipeline is proven against real Postgres before any canvas work starts.
- Tests marked *DB* run against a real Postgres container through `test/pg.ts`.
- The **Status** column tracks each phase: `todo` (default), `working` while it's being built, `done` once its test passes and it's complete.

### A. Project setup

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| A1 | Initialize the pnpm monorepo, strict base TS config, ESLint, Prettier | *generated* (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, lint configs) | `pnpm install` and `pnpm lint` succeed | done |
| A2 | Scaffold `packages/core` with Vitest | *generated* (package config, `src/index.ts`, `vitest.config.ts`) | A placeholder Vitest test passes | done |
| A3 | Scaffold `apps/desktop` with the electron-vite React TS template | *generated* | `pnpm dev` opens a window | done |
| A4 | Add Tailwind and initialize shadcn/ui in the renderer | *generated* | A shadcn `Button` renders with Tailwind styles | done |
| A5 | Component testing: Vitest with jsdom and React Testing Library in the desktop app | `apps/desktop/vitest.config.ts`, `renderer/test-setup.ts` | A component test renders the placeholder App | done |
| A6 | End-to-end testing: Playwright `_electron` | `apps/desktop/playwright.config.ts` | An E2E spec launches the app and reads the window title | done |
| A7 | CI: install, lint, typecheck, unit and component tests | `.github/workflows/ci.yml` | A push produces a green run | done |
| A8 | Postgres test helper with Testcontainers, version from `PG_VERSION` env (default 16) | `core/test/pg.ts` | *DB*: `SELECT version()` returns the expected major version | done |
| A9 | CI matrix for Postgres 14–18 on DB tests, plus the E2E job | `ci.yml` | Five green DB jobs and a green E2E job | done |

### B. Core model and SQL primitives

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| B1 | All schema model interfaces: `readOnly` reasons, identity kind, `exclusion` constraint kind, `unmodeled` map | `model/types.ts` | A fixture model typechecks | done |
| B2 | ID helpers: OID-based IDs and `newId()` | `model/ids.ts` | Same OIDs give same IDs; new IDs are unique | done |
| B3 | `quoteIdent`, `quoteLiteral`, `qualified(schema, name)` | `sql/quote.ts` | Embedded quotes, mixed case, reserved words, unicode, empty strings | done |
| B4 | Parse `format_type` output into `PgType`; render `PgType` back to SQL | `sql/pgtype.ts` | Table-driven: `varchar(255)`, `numeric(10,2)`, `timestamptz`, `text[]`, schema-qualified enum | done |
| B5 | Validation: empty and over-63-byte names; Postgres namespaces (relations per schema, constraints per table, PK/unique names as index names) | `model/validate.ts` | An index named like a table fails; two tables with the same check name pass | done |
| B6 | Validation: one PK per table, existing referenced columns, PK and identity coupling, FK targets (PK, unique constraint, or qualifying unique index; self-references allowed), type parameters, pending table schema exists | `model/validate.ts` | FK onto a partial unique index fails; an index on a removed column fails; a nullable PK column fails | done |
| B7 | Naming: port of `makeObjectName`, numbered collision handling, and the `assignNames` pass over auto-named objects | `model/naming.ts` | *DB*: unnamed PK, unique, FK, one- and multi-column checks and indexes created in a container, including very long names and collisions, get the same names as ours; renaming a pending table renames its auto-named constraints while a user-named one stays | done |

### C. Introspection

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| C1 | `Query` type and read-only `REPEATABLE READ` snapshot helper with `search_path = ''` | `introspect/query.ts` | *DB*: queries inside report `repeatable read`, reject writes, and return fully qualified expressions | todo |
| C2 | Extension-owned object detection via `pg_depend` | `introspect/extensions.ts` | *DB*: after `CREATE EXTENSION pg_trgm`, its objects are listed | todo |
| C3 | Schemas query | `introspect/schemas.ts` | *DB*: user schemas returned, system schemas excluded | todo |
| C4 | Tables query, comments; partitioned tables and partitions read-only | `introspect/tables.ts` | *DB*: a partition child is marked read-only | todo |
| C5 | Columns query: types, NOT NULL, raw defaults, identity kind, generated flag, comments | `introspect/columns.ts` | *DB*: a generated column is read-only; identity `ALWAYS` and `BY DEFAULT` are distinguished | todo |
| C6 | Constraints query: PK, unique, check with `conkey` columns, FK (actions, match type), deferrable, validated, no-inherit; exclusion as `kind: 'exclusion'`; `contype 'n'` excluded | `introspect/constraints.ts` | *DB*: on Postgres 18, NOT NULL columns produce no constraint objects; a multi-column check lists both columns; a `NOT VALID` FK is read-only | todo |
| C7 | Indexes query with full read-only classification; constraint-backed indexes folded | `introspect/indexes.ts` | *DB*: plain unique index editable; partial, expression, GIN, `DESC`, `INCLUDE` and `NULLS NOT DISTINCT` indexes read-only | todo |
| C8 | Enums query with ordered labels (read-only) | `introspect/enums.ts` | *DB*: labels returned in `enumsortorder` | todo |
| C9 | Unmodeled objects and dependencies: views, materialized views, foreign tables, sequences, triggers, functions, policies | `introspect/unmodeled.ts` | *DB*: a view depending on a column is linked to that column | todo |
| C10 | Cast data (all of `pg_cast`, type categories) and coercion rules | `introspect/casts.ts`, `sql/coercion.ts` | *DB*: for a matrix of type pairs (integers, numerics, text, varchar lengths, enum, arrays, domain), our "needs `USING`" answer matches whether an `INSERT` of the old type into the new type succeeds, on Postgres 14–18 | todo |

### D. Fingerprint

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| D1 | Fingerprint query over selected definition columns plus OIDs | `fingerprint/fingerprint.ts` | *DB*: stable when nothing changes and after `INSERT`, `VACUUM`, `VACUUM FULL` and `ANALYZE`; changes after each kind of DDL and after dropping and recreating an identical table; editing a function body or a policy doesn't change it | todo |
| D2 | Coverage guard against the database's real catalog table list | `fingerprint/fingerprint.ts` | Fails when an introspection query reads a catalog table the fingerprint doesn't cover; ignores functions like `pg_get_expr` | todo |
| D3 | Assemble model, cast data and fingerprint in one snapshot | `introspect/index.ts` | *DB*: snapshot test of `fixtures/basic.sql`; fingerprint read in the same transaction | todo |

### E. Diff engine

All unit tests: two hand-built models in, expected `ChangeOp[]` out.

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| E1 | `ChangeOp` union type | `diff/ops.ts` | Typecheck | todo |
| E2 | Schemas: create | `diff/schemas.ts` | A new schema yields `createSchema` | todo |
| E3 | Tables: create, rename, drop; schema change on an existing table is a blocking error | `diff/tables.ts` | Renamed table keeps its ID and yields `renameTable`, not drop + create | todo |
| E4 | Columns: add (including identity on new columns), drop, rename | `diff/columns.ts` | Same identity check for columns | todo |
| E5 | Columns: type, NOT NULL, default changes | `diff/columns.ts` | One op per changed property | todo |
| E6 | Constraints: add, drop, rename; changed = drop + add; self-referencing FKs | `diff/constraints.ts` | Changed FK action yields drop + add; renamed constraint yields `renameConstraint` | todo |
| E7 | Indexes: same rules as constraints | `diff/indexes.ts` | Column order change yields drop + add; rename yields `renameIndex` | todo |
| E8 | Comments on tables and columns | `diff/comments.ts` | Set, change, clear | todo |
| E9 | Read-only guard: block changes that would drop dependent read-only objects | `diff/readonly-guard.ts` | Dropping a column used by a view or by a read-only FK on another table returns a blocking error, no op; a partial index on the same table is dropped and flagged destructive | todo |
| E10 | FK type-change rule: drop and re-add only when both sides change to an incompatible in-between state | `diff/fk-type-changes.ts` | `int → bigint` on one side emits no extra ops; `uuid → text` on both sides emits drop + add | todo |
| E11 | Assemble the diff, including dropping FKs that point at dropped tables or columns | `diff/index.ts` | Dropping a referenced table also yields `dropConstraint` for the referencing FK | todo |

### F. Ordering and SQL rendering

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| F1 | Phase assignment and deterministic sort | `order/order.ts` | FK added after its target table; same input gives identical order | todo |
| F2 | Render schema statements | `render/schemas.ts` | Snapshot of `CREATE SCHEMA` | todo |
| F3 | Render table statements | `render/tables.ts` | Snapshot: create with identity PK, rename, drop | todo |
| F4 | Render column statements; `USING` only where the coercion rules find no assignment conversion | `render/columns.ts` | Snapshot: `text → integer` includes `USING`; `varchar(50) → varchar(20)` doesn't | todo |
| F5 | Render constraint and index statements, including renames | `render/constraints.ts`, `render/indexes.ts` | Snapshot: composite FK with actions; index rename | todo |
| F6 | Render comment statements | `render/comments.ts` | Snapshot with a quote inside the comment | todo |
| F7 | Assemble the migration: header from `context`, `BEGIN`/`COMMIT`; return text and statement array | `render/migration.ts` | Snapshot with fixed `generatedAt` is byte-identical across runs | todo |

### G. Risk classification

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| G1 | Type-change matrix: safe widenings and lossy conversions | `risk/type-changes.ts` | Table-driven; an unlisted pair returns "may fail" | todo |
| G2 | `assessRisk` for every op kind | `risk/assess.ts` | One case per level; `addIndex` is "locks"; `addColumn` NOT NULL without default is "may fail" | todo |
| G3 | Warning comments and risk counts in the migration | `render/migration.ts` | Snapshot shows `-- WARNING` above a `DROP COLUMN` | todo |

### H. Round trips and normalization

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| H1 | Name-based comparison: does a model match the desired model by qualified names? | `diff/applied.ts` | Same schema with different IDs matches; one extra column doesn't | todo |
| H2 | Round-trip helper: apply migration to a fresh database, re-introspect, compare with `applied.ts` | `test/roundtrip.ts` | *DB*: 20 hand-written edit cases round-trip exactly | todo |
| H3 | `fast-check` arbitraries for models and edits | `test/arbitraries.ts` | *DB*: property test, 200 runs, every generated edit round-trips | todo |
| H4 | Expression normalization on its own connection, whole-table temp copy, extended protocol, TEMP fallback | `normalize/expression.ts` | *DB*: `CURRENT_TIMESTAMP` and `now()` normalize alike; an unqualified `uuid_generate_v4()` from an extension in `public` comes back as `public.uuid_generate_v4()`; `end_date > start_date` normalizes; `1); COMMIT; …` fails; a role without TEMP gets the fallback | todo |
| H5 | Normalization used by round trips so defaults compare cleanly | `test/roundtrip.ts` | *DB*: round trips with custom defaults produce no phantom diff | todo |
| H6 | Nightly property run with 2,000 cases across Postgres 14–18 | `.github/workflows/nightly.yml` | A manual trigger of the workflow passes | todo |

### I. Desktop main process foundation

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| I1 | All IPC channel names and zod schemas | `shared/ipc-contract.ts` | Valid inputs parse; malformed ones are rejected | todo |
| I2 | Generic IPC register helper, domain registry, typed preload bridge | `main/ipc/register.ts`, `main/ipc/index.ts`, `preload/index.ts` | A `ping` channel round-trips; an invalid payload is rejected in main | todo |
| I3 | Logger with password and connection-string redaction | `main/log.ts` | A logged URL has its password removed | todo |
| I4 | App database with migrations | `store/db.ts`, `store/migrations/001_init.sql` | Temp database reaches `user_version = 1` with all four tables and the SSL and URL columns | todo |
| I5 | Connections repository | `store/connections.ts` | Insert, list by recency, delete; URL stored without password or `sslmode` | todo |
| I6 | Secrets with keyring backend check | `services/secrets.ts` | With `basic_text` or `unknown` mocked, remembering a password is refused; the check never runs before `ready` | todo |
| I7 | Driver error mapping, including SSL errors | `services/errors.ts` | Each signal in the error table maps to its message | todo |
| I8 | Main connection: SSL options built per mode (with `prefer` fallback), `search_path` pin, version check, `application_name`, serialized queries | `services/connection.ts`, `services/ssl.ts` | *DB*: against an SSL-enabled container, `require` connects, `verify-full` with the wrong CA fails, `prefer` falls back on a server without SSL; Postgres 13 is rejected; concurrent queries never interleave | todo |
| I9 | Task connections and `runSingle` (`queryMode: 'extended'`) | `services/task-connection.ts`, `services/run-single.ts` | *DB*: a task connection's open transaction is invisible to the main connection; `SELECT 1; SELECT 2` through `runSingle` fails | todo |
| I10 | Data directory with `PGSKETCH_DATA_DIR` override; single app instance | `main/paths.ts`, `main/index.ts` | E2E: two instances with different data directories run side by side; a second launch with the same one focuses the first and exits | todo |
| I11 | Connection channels: `defaults`, `test`, `open`, `openSaved`, `close`, `recent`, `forget` | `main/ipc/connection.ts` | E2E: the renderer's `connection.test` reaches a container; `openSaved` works without the renderer ever receiving the password | todo |

### J. Connection screen

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| J1 | Typed renderer API client, screen switching, placeholder Editor screen | `renderer/api.ts`, `renderer/App.tsx`, `screens/Editor.tsx` | App shows Connect by default and can switch to the placeholder Editor | todo |
| J2 | Connect form: params, URL and socket modes, SSL mode with defaults, OS-username default for sockets, zod validation | `screens/Connect.tsx` | Component test: socket mode fills the OS username; a remote host defaults to `require` | todo |
| J3 | Submit, mapped error display, recent connections via `openSaved`, remember | `screens/Connect.tsx` | E2E: wrong password shows the message; success opens the Editor screen | todo |

### K. Schema loading and editor state

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| K1 | Introspector service and `schema.load` channel | `services/introspector.ts`, `main/ipc/schema.ts` | E2E: the editor receives the fixture model, cast data and fingerprint | todo |
| K2 | Schema store core slice and table actions (add, remove, rename, restore) | `stores/schema/core.ts`, `stores/schema/tables.ts` | A new table starts with an `id bigint` identity PK; rename changes `desired` only; remove then restore leaves an empty diff | todo |
| K3 | Derived diff, risks, validation and status map | `stores/derived.ts`, `canvas/status.ts` | Renamed column has status `modified` with its old name | todo |
| K4 | Column actions with coupling rules: add, remove, rename, flags, type, default, comment | `stores/schema/columns.ts` | Turning PK on sets NN; NN can't be turned off while PK is on; identity rejects a default | todo |
| K5 | Constraint, index and FK actions, including self-references | `stores/schema/constraints.ts` | A self-referencing FK produces one `addConstraint` | todo |
| K6 | Schema actions: create schema; change schema of pending tables only | `stores/schema/schemas.ts` | Changing an existing table's schema is rejected by the action | todo |
| K7 | Cascade on column removal: constraints and indexes on the table that include the column, and FKs on other tables that reference it, are removed with it and restored with it | `stores/schema/columns.ts`, `stores/schema/constraints.ts` | Removing a column in a composite unique constraint, a multi-column check, and an FK from another table marks all three removed; restore brings all four back; the diff drops them before the column and generation isn't blocked. A column with a partial index can be removed (the index is listed as destructive); one used by a view or a read-only FK on another table can't | todo |

### L. Canvas rendering

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| L1 | React Flow canvas fed by the union of baseline and desired | `canvas/Canvas.tsx`, `screens/Editor.tsx` | E2E: every fixture table appears as a node | todo |
| L2 | Static table node and column rows | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | Component test: badges, default chip and FK target render | todo |
| L3 | FK edges with crow's-foot markers, self-reference loops, per-column handles | `canvas/FkEdge.tsx`, `canvas/ColumnRow.tsx` | E2E: edge count equals FK count; a self-reference renders as a loop | todo |
| L4 | Auto-layout in a worker with per-column ports | `layout/elk.worker.ts`, `layout/autoLayout.ts` | Unit: ELK output maps to node positions; no overlapping nodes | todo |
| L5 | Layout repository and channels | `store/layouts.ts`, `main/ipc/layouts.ts`, `main/ipc/connection.ts` | Positions saved and read back per `dbKey`; rows for missing tables are pruned on load; forgetting a connection deletes its layouts | todo |
| L6 | Renderer layout store with debounced save and restore | `stores/layout.ts` | E2E: moved node keeps its position after restart | todo |
| L7 | Compact nodes below 70% zoom | `canvas/CompactNode.tsx`, `canvas/Canvas.tsx` | E2E: zooming out switches node type | todo |
| L8 | Status styling: added, modified, removed, error, read-only with reason | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | Component test: each status applies its style | todo |
| L9 | Schema filter, with stubs for FK edges to hidden tables | `chrome/SchemaFilter.tsx`, `canvas/Canvas.tsx` | E2E: hiding a schema hides its tables and stubs edges into it | todo |

### M. Canvas editing

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| M1 | Inline text editing for table and column names | `editors/InlineText.tsx`, `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | E2E: rename a column; it turns amber and the change count updates | todo |
| M2 | Input safety: `nodrag nopan`, Delete/Backspace guarded | `editors/InlineText.tsx`, `canvas/Canvas.tsx` | E2E: selecting text doesn't move the node; Backspace doesn't delete it | todo |
| M3 | Badge toggles for PK, NN, UQ, with NN locked for PK and identity columns | `canvas/ColumnRow.tsx` | E2E: toggling NN produces `setNotNull`; toggling PK turns NN on and locks it | todo |
| M4 | Type picker popover with built-in types, existing enums, parameters, array toggle | `editors/TypePicker.tsx`, `canvas/ColumnRow.tsx` | Component test: choosing `varchar` shows a length input; an existing enum is listed | todo |
| M5 | Add and delete columns; Tab/Enter keyboard flow | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | E2E: create three columns using only the keyboard | todo |
| M6 | New table on double-click in the filtered schema; table toolbar | `canvas/Canvas.tsx`, `canvas/TableToolbar.tsx` | E2E: a new table appears at the cursor with its name focused | todo |
| M7 | Schema picker for pending tables, with "New schema…" | `editors/SchemaPicker.tsx`, `canvas/TableNode.tsx` | E2E: a pending table moves to a new schema; an existing table shows no picker | todo |
| M8 | Removed items struck through and restorable, including incoming FK edges of a deleted table | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx`, `canvas/FkEdge.tsx` | E2E: deleting a referenced table marks its incoming edges removed; restore brings both back | todo |
| M9 | Normalizer service on task connections and `expr.normalize` channel | `services/normalizer.ts`, `main/ipc/expr.ts` | *DB*: returns normalized text, a check's referenced columns, errors, and the TEMP fallback; requests reuse one connection, which closes after 30 s idle | todo |
| M10 | Expression input with live normalization | `editors/ExpressionInput.tsx` | Component test with mocked API shows errors inline; one request 400 ms after typing stops; cached results aren't requested again | todo |
| M11 | Default popover: presets per type, constant, custom; disabled on identity columns | `editors/DefaultPopover.tsx`, `canvas/ColumnRow.tsx` | E2E: choose `now()` on a `timestamptz` column; the chip can't be opened on an identity column | todo |
| M12 | FK by dragging between handles, including onto the same table; FK edge popover | `canvas/Canvas.tsx`, `editors/FkPopover.tsx` | E2E: drag creates an FK and a self-reference; changing `ON DELETE` yields drop + add | todo |
| M13 | Node footer with index editor | `canvas/NodeFooter.tsx`, `editors/IndexEditor.tsx` | E2E: add a composite unique index; it's named `t_a_b_idx` | todo |
| M14 | Check constraint editor | `editors/CheckEditor.tsx`, `canvas/NodeFooter.tsx` | E2E: invalid check expression shows the Postgres error; a two-column check is named `t_check`; in fallback mode the check editor is disabled with an explanation | todo |
| M15 | Table and column comments | `editors/CommentPopover.tsx`, `canvas/TableToolbar.tsx`, `canvas/ColumnRow.tsx` | E2E: a column comment yields `setComment` | todo |
| M16 | Read-only objects: lock icon with reason, no edit affordances; unmodeled-objects badge in the footer | `canvas/TableNode.tsx`, `canvas/NodeFooter.tsx` | E2E: a partial index, an exclusion constraint and a generated column can't be edited; a table with a view on it shows "1 view" with the name on hover | todo |
| M17 | Validation errors shown on nodes | `canvas/TableNode.tsx`, `canvas/ColumnRow.tsx` | E2E: an index named like a table shows a red outline and message | todo |

### N. Persistence and change detection

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| N1 | Drafts repository and channels | `store/drafts.ts`, `main/ipc/drafts.ts`, `main/ipc/connection.ts` | Save, read, clear by `dbKey`, including unsaved connections; forgetting a connection deletes its drafts | todo |
| N2 | Fingerprint poller on the main connection, comparing with the last-seen value; `schema.fingerprint` channel; `schema:changed` event | `services/poller.ts`, `main/ipc/schema.ts` | *DB*: an external `ALTER TABLE` emits one event within 5 s and no repeats; `ANALYZE` emits none | todo |
| N3 | Debounced draft saving; restore on session start only with matching fingerprint and existing IDs, otherwise discard with a notice | `stores/persistence.ts`, `screens/Editor.tsx` | E2E: edits survive a restart; a dump/restore of the database while closed never restores the stale draft | todo |
| N4 | `onSchemaChanged` handler: re-introspect, compare by name, adopt or mark stale; wired to the poller event and to session start (replacing N3's plain discard) | `stores/schema/core.ts`, `screens/Editor.tsx` | E2E: running the generated SQL externally shows "Changes applied" and clears the draft; applying half of it marks stale, applying the rest recovers; SQL applied while the app was closed shows "Changes applied" on the next start; an edit made during a slow re-introspect is kept and the session goes stale instead of adopting; an input left open during an external apply delays the adopt, and the typed text is preserved | todo |
| N5 | Layout remap on adopt: positions move to the new IDs of tables with the same qualified name | `stores/layout.ts`, `stores/schema/core.ts` | E2E: a newly created table keeps the position it had as a pending table after adopt | todo |
| N6 | Stale banner, reload with confirmation | `chrome/StaleBanner.tsx`, `stores/schema/core.ts` | E2E: an unrelated external change shows the banner; reload discards edits after confirming | todo |
| N7 | Lost-connection detection and banner | `services/connection.ts`, `chrome/StaleBanner.tsx` | E2E: stopping the container shows the reconnect banner | todo |

### O. SQL panel and validation

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| O1 | Top bar: database, schema filter slot, change and risk counts, buttons with disabled states | `chrome/TopBar.tsx`, `screens/Editor.tsx` | Generate SQL disabled with no changes or validation errors | todo |
| O2 | SQL panel: pre-check against `loadedFingerprint` (handler on mismatch, generation stops), fresh cast data via `schema.casts`, CodeMirror view | `sql/SqlPanel.tsx`, `sql/SqlView.tsx`, `main/ipc/schema.ts` | E2E: SQL appears; an unrelated external change blocks it; an applied migration is adopted instead; a failing handler leaves generation blocked | todo |
| O3 | Risk summary | `sql/RiskSummary.tsx` | Component test: counts and expandable lists | todo |
| O4 | Copy button | `sql/SqlPanel.tsx` | E2E: clipboard holds the SQL | todo |
| O5 | Save via native dialog, filename pattern, last folder | `services/files.ts`, `store/settings.ts`, `main/ipc/files.ts` | Unit: filename format; the second save opens in the first save's folder | todo |
| O6 | Validator on a task connection through `runSingle`; `sql.validate` channel | `services/validator.ts`, `main/ipc/sql.ts` | *DB*: `SET NOT NULL` on a column with nulls fails at the right statement; fingerprint unchanged after; the poller never reports a change during a run; an expression containing `; COMMIT;` can't end the transaction; a fingerprint change aborts the run; the dry run uses the original `search_path` | todo |
| O7 | Validate results and non-local host confirmation | `sql/ValidateResults.tsx`, `sql/SqlPanel.tsx` | E2E: results shown per statement; a non-local host asks first | todo |

### P. Packaging and release

| # | Phase | Files | Test | Status |
| --- | --- | --- | --- | --- |
| P1 | `.deb` config, icon and desktop entry | `electron-builder.yml` | The built `.deb` installs on a clean Debian-based system and launches | todo |
| P2 | CI packaging job with packaged-app smoke test | `ci.yml` | Packaged app opens the Connect screen and quits cleanly | todo |
| P3 | README: install, usage, screenshots, architecture | `README.md` | Reviewed against a fresh install | todo |
| P4 | Tag 0.1.0 and publish the GitHub Release | none | `.deb` downloadable from the release | todo |

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

**Fixtures.** `core/test/fixtures/` holds SQL files that set up realistic schemas: two schemas with a cross-schema FK, a self-referencing FK, an existing enum, composite keys, a view, a materialized view, a trigger, a partitioned table, partial, `DESC` and `INCLUDE` indexes, an exclusion constraint, a generated column, both identity kinds, a `serial` column, and an extension. Every introspection and E2E test starts from one of these.

**Determinism and isolation checks.** Generating SQL twice from the same diff with the same `generatedAt` must produce identical text. The fingerprint must be identical across two reads with no DDL between them, and after `VACUUM` and `ANALYZE`. A Validate run must never cause the poller to report a change.

## Risks and after 0.1.0

The biggest risk is a migration that silently does the wrong thing; most mitigations exist to make that impossible rather than unlikely.

| Risk | Mitigation |
| --- | --- |
| Generated SQL drops something it shouldn't | Read-only rule for anything unmodeled; read-only guard blocks dependent drops; stale fingerprint blocks generation; round-trip and property tests |
| A restored draft points at objects that no longer exist (dump/restore, drop and recreate) | OIDs in the fingerprint; restore also requires every OID-based ID to exist in the baseline |
| A changed object silently loses attributes | Any object with an unmodeled attribute is read-only, so it's never dropped and re-added |
| Model and database disagree after applying | Coupling rules (PK and identity imply NOT NULL), column-removal cascade, and Postgres's own naming algorithm, all checked by round-trip tests |
| False changes from expression formatting | Expressions normalized by the connected database with `search_path` pinned; raw-text fallback with a warning when temp tables aren't allowed |
| Silent truncation from type changes | `USING` only where no assignment conversion exists, with coercion rules checked against Postgres itself |
| Rename misread as drop + add | Stable OID-based IDs; renames tracked by identity |
| Transactions interfering on a shared connection | Validate and normalization on their own task connections; main connection queries serialized |
| User expressions escaping the dry run | `runSingle` forces the extended protocol, one statement per message |
| SSL behaving differently than the user chose, or changing with a `pg` upgrade | SSL options built explicitly per mode; `sslmode` never passed to `pg`; SSL tested against a real server |
| False stale banners | Fingerprint hashes definition columns and OIDs only, never statistics; poller compares with the last-seen value |
| Users asked to discard changes they just applied | One change handler that adopts when the database matches the edits by name, at poll time, pre-check and session start; the adopt is decided synchronously after the load, guarded by a version counter, and deferred while an editor is open, so in-flight edits are never overwritten |
| Introspection misses a catalog detail added later | Fingerprint coverage test; fixtures that include every modeled and read-only feature |
| Validate locks a busy table | `lock_timeout` 3 s, `statement_timeout` 30 s, explicit button, non-local confirmation |
| Catalog differences across Postgres versions | CI matrix 14–18 on every DB test, including Postgres 18's `contype 'n'` rows |
| Canvas sluggish on large schemas | Text-only cells, single active input, compact nodes below 70% zoom, schema filter, layout in a worker |
| Passwords stored weakly | Refuse to remember passwords when the keyring backend is `basic_text` or `unknown` |
| `better-sqlite3` breaks in the packaged app | Native rebuild in packaging; packaged smoke test in CI |
| Flaky E2E runs | Each test gets its own `PGSKETCH_DATA_DIR`, so data and the single-instance lock never collide |
| Scope creep | Anything outside the goals list goes to the roadmap below |

### After 0.1.0

- **0.2:** creating and editing enums; renaming and dropping existing schemas and moving tables between schemas; turning identity on or off for existing columns; undo/redo; table search; impact numbers in warnings (rows affected, nulls, duplicates, table size estimate); rebase unsaved edits onto unrelated external changes.
- **0.3:** views and sequences as editable objects; partial and expression indexes; SSH tunnels.
- **0.4:** multiple databases per window; schema export as an image or documentation.
- **Later:** a CLI built from `packages/core` for CI drift checks; down migrations; `node:sqlite` once stable; more platforms and package formats.
