import { fingerprint } from '../fingerprint/fingerprint';
import type { Id, SchemaModel } from '../model/types';
import type { CastData } from '../sql/coercion';
import { introspectCasts } from './casts';
import { introspectColumns } from './columns';
import { introspectConstraints } from './constraints';
import { introspectEnums } from './enums';
import { introspectIndexes } from './indexes';
import { withSnapshot, type Query } from './query';
import { introspectSchemas } from './schemas';
import { introspectTables } from './tables';
import { introspectUnmodeled } from './unmodeled';

const byId = <T extends { id: Id }>(items: T[]): Record<Id, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

/** Everything about the schema except cast data. Call inside a snapshot. */
export async function introspectModel(query: Query): Promise<SchemaModel> {
  // one connection, so the queries run one after another
  const schemas = await introspectSchemas(query);
  const tables = await introspectTables(query);
  const columns = await introspectColumns(query);
  const constraints = await introspectConstraints(query);
  const indexes = await introspectIndexes(query);
  const enums = await introspectEnums(query);
  const unmodeled = await introspectUnmodeled(query);
  return {
    schemas: byId(schemas),
    tables: byId(tables),
    columns: byId(columns),
    constraints: byId(constraints),
    indexes: byId(indexes),
    enums: byId(enums),
    unmodeled: byId(unmodeled),
  };
}

export interface Introspection {
  model: SchemaModel;
  casts: CastData;
  /** Describes exactly the schema in `model`: it is read in the same snapshot. */
  fingerprint: string;
}

export async function introspect(query: Query): Promise<Introspection> {
  return withSnapshot(query, async () => {
    const model = await introspectModel(query);
    const casts = await introspectCasts(query);
    return { model, casts, fingerprint: await fingerprint(query) };
  });
}
