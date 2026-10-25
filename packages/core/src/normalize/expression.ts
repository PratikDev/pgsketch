import type { Id, PgType } from '../model/types';
import type { Query } from '../introspect/query';
import { renderPgType } from '../sql/pgtype';
import { quoteIdent } from '../sql/quote';

/** One column of the table an expression belongs to, existing or pending. */
export interface ExpressionColumn {
  id: Id;
  name: string;
  type: PgType;
}

export interface ExpressionContext {
  /** Every column of the table, in table order: a check may use any of them. */
  columns: ExpressionColumn[];
  /** The connection's `search_path` as it was before it was pinned, so unqualified names resolve as in the user's own session. */
  searchPath: string;
}

export type ExpressionTarget =
  /** A default on one of the table's columns. */
  { kind: 'default'; columnId: Id } | { kind: 'check' };

export type NormalizedExpression =
  /** The text Postgres reads the expression back as, and for a check the columns it uses, in the order Postgres stores them (as they first appear in the expression). */
  | { status: 'normalized'; expression: string; columnIds: Id[] }
  /** Postgres rejected it; `message` is its own, meant to be shown next to the input. */
  | { status: 'invalid'; message: string }
  /** This role can't create temporary tables (or the transaction is read-only), so the text is kept as typed. */
  | { status: 'raw'; expression: string };

const TABLE = 'pg_temp.pgsketch_expression';

/** The connection's current `search_path`, in the form `SET` accepts back. Read it before introspection pins it. */
export async function currentSearchPath(query: Query): Promise<string> {
  const [row] = await query<{ search_path: string }>('SHOW search_path');
  if (!row) throw new Error('No search_path');
  return row.search_path;
}

async function canCreateTemporaryTables(query: Query): Promise<boolean> {
  const [row] = await query<{ ok: boolean }>(
    `SELECT has_database_privilege(current_database(), 'TEMP')
        AND NOT pg_is_in_recovery()
        AND current_setting('transaction_read_only') = 'off' AS ok`,
  );
  return row?.ok === true;
}

/**
 * The canonical form of a default or check expression, as the connected database prints it:
 * `CURRENT_TIMESTAMP` stays itself, `'active'` comes back as `'active'::text`, and a function from
 * an extension comes back schema-qualified. The expression is parsed by Postgres in a temporary
 * copy of the whole table inside a transaction that is always rolled back, with the user's own
 * `search_path`, then read back with an empty one so every name is qualified.
 *
 * `query` must send one statement per message (the extended protocol), so an expression like
 * `1); COMMIT; …` is a syntax error instead of more statements. What the expression says can only
 * change the temporary table, which is gone after the rollback; nothing in it is ever evaluated.
 */
export async function normalizeExpression(
  query: Query,
  expression: string,
  target: ExpressionTarget,
  context: ExpressionContext,
): Promise<NormalizedExpression> {
  await query('BEGIN');
  try {
    if (!(await canCreateTemporaryTables(query)))
      return { status: 'raw', expression: expression.trim() };

    await query(`SELECT set_config('search_path', $1, true)`, [
      context.searchPath,
    ]);
    const columns = context.columns
      .map((c) => `${quoteIdent(c.name)} ${renderPgType(c.type)}`)
      .join(', ');
    const alter =
      target.kind === 'check'
        ? `ADD CONSTRAINT pgsketch_check CHECK (${expression})`
        : `ALTER COLUMN ${quoteIdent(columnOf(context, target.columnId).name)} SET DEFAULT ${expression}`;
    try {
      await query(`CREATE TEMP TABLE ${TABLE} (${columns})`);
      await query(`ALTER TABLE ${TABLE} ${alter}`);
    } catch (error) {
      return {
        status: 'invalid',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    await query(`SELECT set_config('search_path', '', true)`);
    if (target.kind === 'default') {
      const [row] = await query<{ expression: string }>(
        `SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
           FROM pg_attrdef d
           JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
          WHERE d.adrelid = '${TABLE}'::regclass AND a.attname = $1`,
        [columnOf(context, target.columnId).name],
      );
      if (!row) throw new Error('The default was not stored');
      return {
        status: 'normalized',
        expression: row.expression,
        columnIds: [],
      };
    }
    const [row] = await query<{ expression: string; columns: string[] }>(
      `SELECT pg_get_expr(c.conbin, c.conrelid) AS expression,
              ARRAY(SELECT a.attname::text
                      FROM unnest(c.conkey) WITH ORDINALITY k (attnum, position)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                     ORDER BY k.position) AS columns
         FROM pg_constraint c
        WHERE c.conrelid = '${TABLE}'::regclass AND c.contype = 'c'`,
    );
    if (!row) throw new Error('The check was not stored');
    const byName = new Map(context.columns.map((c) => [c.name, c.id]));
    return {
      status: 'normalized',
      expression: row.expression,
      columnIds: row.columns.map((name) => byName.get(name) ?? name),
    };
  } finally {
    await query('ROLLBACK');
  }
}

function columnOf(context: ExpressionContext, id: Id): ExpressionColumn {
  const column = context.columns.find((c) => c.id === id);
  if (!column) throw new Error(`Unknown column ${id}`);
  return column;
}
