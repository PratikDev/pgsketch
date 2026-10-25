import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { firstDifference } from '../src/diff/applied';
import { diff } from '../src/diff';
import { introspect } from '../src/introspect';
import type { Query } from '../src/introspect/query';
import { assignNames } from '../src/model/naming';
import { validateModel } from '../src/model/validate';
import { renderMigration, type Migration } from '../src/render/migration';
import type { SchemaModel } from '../src/model/types';
import {
  currentSearchPath,
  normalizeExpression,
  type ExpressionContext,
} from '../src/normalize/expression';
import { samePgType } from '../src/sql/pgtype';
import { quoteIdent } from '../src/sql/quote';
import { extendedQuery, type TestPostgres } from './pg';

export interface RoundTripResult {
  migration: Migration;
  /** The first object where the database after the migration differs from the edited model; `null` when none. */
  difference: string | null;
}

/**
 * What the editor does for every expression it holds: has Postgres write a default or check out in
 * its canonical form, so the edited model and the database read back the same text. A default is
 * written again when its text or its column's type changed, since a type change coerces it; a check
 * only when it is new. An expression Postgres rejects throws, as the editor would show the error.
 */
async function normalizeEdited(
  query: Query,
  baseline: SchemaModel,
  desired: SchemaModel,
): Promise<void> {
  const searchPath = await currentSearchPath(query);
  const contextOf = (tableId: string): ExpressionContext => ({
    searchPath,
    columns: Object.values(desired.columns)
      .filter((c) => c.tableId === tableId)
      .sort((a, b) => a.position - b.position)
      .map(({ id, name, type }) => ({ id, name, type })),
  });

  for (const column of Object.values(desired.columns)) {
    const before = baseline.columns[column.id];
    if (
      !column.default ||
      (before &&
        before.default?.expression === column.default.expression &&
        samePgType(before.type, column.type))
    )
      continue;
    const result = await normalizeExpression(
      query,
      column.default.expression,
      { kind: 'default', columnId: column.id },
      contextOf(column.tableId),
    );
    if (result.status === 'invalid')
      throw new Error(`Invalid default on "${column.name}": ${result.message}`);
    column.default = { ...column.default, expression: result.expression };
  }
  for (const constraint of Object.values(desired.constraints)) {
    if (constraint.kind !== 'check' || baseline.constraints[constraint.id])
      continue;
    const result = await normalizeExpression(
      query,
      constraint.expression,
      { kind: 'check' },
      contextOf(constraint.tableId),
    );
    if (result.status === 'invalid')
      throw new Error(`Invalid check: ${result.message}`);
    constraint.expression = result.expression;
    if (result.status === 'normalized') constraint.columnIds = result.columnIds;
  }
}

/**
 * The round trip: in a fresh database, run `setup`, load the schema, let `edit` change a copy,
 * normalize the expressions it typed, generate the migration, run it, load the schema again and
 * compare it with the edited copy by name. An edit that fails validation or diffing, or a migration
 * Postgres rejects, throw with the SQL.
 */
export async function roundTrip(
  pg: TestPostgres,
  setup: string,
  edit: (desired: SchemaModel, baseline: SchemaModel) => void,
): Promise<RoundTripResult> {
  const name = `roundtrip_${randomUUID().replaceAll('-', '')}`;
  await pg.client.query(`CREATE DATABASE ${quoteIdent(name)}`);
  const url = new URL(pg.connectionUri);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const query = extendedQuery(client);
  try {
    await client.query(setup);
    const { model: baseline, casts } = await introspect(query);
    const desired = structuredClone(baseline);
    edit(desired, baseline);
    await normalizeEdited(query, baseline, desired);
    const named = assignNames(desired);

    const problems = [
      ...validateModel(named),
      ...diff(baseline, named).errors,
    ].map((e) => e.message);
    if (problems.length > 0)
      throw new Error(`Invalid edits: ${problems.join('; ')}`);

    const migration = renderMigration(diff(baseline, named).ops, {
      baseline,
      desired: named,
      casts,
      generatedAt: 'roundtrip',
      dbName: name,
    });
    try {
      await client.query(migration.text);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${migration.text}`,
        { cause: error },
      );
    }
    const { model: after } = await introspect(query);
    return { migration, difference: firstDifference(after, named) };
  } finally {
    await client.end();
    await pg.client.query(`DROP DATABASE ${quoteIdent(name)} WITH (FORCE)`);
  }
}
