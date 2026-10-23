import type { Constraint, Id, Index, SchemaModel } from './types';
import { clipUtf8, utf8Length } from './utf8';

// Postgres's NAMEDATALEN is 64 including the terminator.
const MAX_BYTES = 63;

/** Port of Postgres's `makeObjectName`: `name1_name2_label`, shortening the longer part first until it fits. */
export function makeObjectName(
  name1: string,
  name2: string | null,
  label: string,
): string {
  const available = MAX_BYTES - (name2 === null ? 0 : 1) - (label.length + 1);
  let n1 = utf8Length(name1);
  let n2 = name2 === null ? 0 : utf8Length(name2);
  while (n1 + n2 > available) {
    if (n1 > n2) n1--;
    else n2--;
  }
  const head = clipUtf8(name1, n1);
  return name2 === null
    ? `${head}_${label}`
    : `${head}_${clipUtf8(name2, n2)}_${label}`;
}

/** The first name not in `taken`, trying `label`, then `label1`, `label2`, ... like Postgres does. */
export function chooseName(
  name1: string,
  name2: string | null,
  label: string,
  taken: Set<string>,
): string {
  for (let pass = 0; ; pass++) {
    const name = makeObjectName(
      name1,
      name2,
      pass === 0 ? label : `${label}${pass}`,
    );
    if (!taken.has(name)) return name;
  }
}

/** Column names joined with `_`, stopping once the result reaches 64 bytes (as Postgres does). */
function columnAddition(names: string[]): string {
  let joined = '';
  for (const name of names) {
    if (joined !== '') joined += '_';
    joined += clipUtf8(name, MAX_BYTES);
    if (utf8Length(joined) > MAX_BYTES) break;
  }
  return joined;
}

type Auto = Constraint | Index;

const KIND_RANK = { pk: 0, unique: 1, fk: 2, check: 3 } as const;
const INDEX_RANK = 4;
const rankOf = (o: Auto) =>
  'kind' in o ? (KIND_RANK[o.kind as keyof typeof KIND_RANK] ?? 5) : INDEX_RANK;

function addTo(map: Map<Id, Set<string>>, schemaId: Id, name: string): void {
  const names = map.get(schemaId) ?? new Set<string>();
  names.add(name);
  map.set(schemaId, names);
}

/**
 * Recomputes the name of every constraint and index with `autoName` set, the way Postgres would
 * name them if they were created without a name. Everything else keeps its name and is treated
 * as taken. Pure, and deterministic: objects are named in a fixed order, so collision numbers
 * (`t_a_key1`) never depend on object ids or edit order.
 */
export function assignNames(model: SchemaModel): SchemaModel {
  const autos: Auto[] = [
    ...Object.values(model.constraints),
    ...Object.values(model.indexes),
  ].filter((o) => o.autoName);
  if (autos.length === 0) return model;

  // Tables, indexes, views and sequences share one namespace per schema; PK/unique/exclusion
  // names live there too. Constraint names (any kind) are a second, schema-wide namespace.
  const relations = new Map<Id, Set<string>>();
  const constraintNames = new Map<Id, Set<string>>();
  const schemaOf = (tableId: Id) => model.tables[tableId]?.schemaId;
  for (const t of Object.values(model.tables))
    addTo(relations, t.schemaId, t.name);
  for (const u of Object.values(model.unmodeled)) {
    if (
      u.schemaId &&
      ['view', 'materialized-view', 'foreign-table', 'sequence'].includes(
        u.kind,
      )
    ) {
      addTo(relations, u.schemaId, u.name);
    }
  }
  for (const i of Object.values(model.indexes)) {
    const schemaId = schemaOf(i.tableId);
    if (schemaId && !i.autoName) addTo(relations, schemaId, i.name);
  }
  for (const c of Object.values(model.constraints)) {
    const schemaId = schemaOf(c.tableId);
    if (!schemaId || c.autoName) continue;
    addTo(constraintNames, schemaId, c.name);
    if (c.kind !== 'check' && c.kind !== 'fk')
      addTo(relations, schemaId, c.name);
  }

  const columnNames = (ids: Id[]) =>
    ids.flatMap((id) => model.columns[id]?.name ?? []);
  const sortKey = (o: Auto) => {
    const table = model.tables[o.tableId];
    const schema = table && model.schemas[table.schemaId];
    return [
      schema?.name,
      table?.name,
      rankOf(o),
      columnNames(o.columnIds).join(','),
      o.id,
    ].join('\0');
  };
  autos.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));

  const renamed: Record<Id, string> = {};
  for (const o of autos) {
    const table = model.tables[o.tableId];
    if (!table || ('kind' in o && o.kind === 'exclusion')) continue;
    const taken = (map: Map<Id, Set<string>>) =>
      map.get(table.schemaId) ?? new Set<string>();
    const columns = columnNames(o.columnIds);
    const kind = 'kind' in o ? o.kind : 'index';

    let name: string;
    if (kind === 'fk' || kind === 'check') {
      const part =
        kind === 'fk'
          ? columnAddition(columns)
          : columns.length === 1
            ? columns[0]!
            : null;
      name = chooseName(
        table.name,
        part,
        kind === 'fk' ? 'fkey' : 'check',
        taken(constraintNames),
      );
    } else {
      const label = { pk: 'pkey', unique: 'key', index: 'idx' }[
        kind as 'pk' | 'unique' | 'index'
      ];
      name = chooseName(
        table.name,
        kind === 'pk' ? null : columnAddition(columns),
        label,
        taken(relations),
      );
    }
    renamed[o.id] = name;
    if (kind !== 'check' && kind !== 'fk')
      addTo(relations, table.schemaId, name);
    if (kind !== 'index') addTo(constraintNames, table.schemaId, name);
  }

  const apply = <T extends Auto>(objects: Record<Id, T>): Record<Id, T> =>
    Object.fromEntries(
      Object.entries(objects).map(([id, o]) => [
        id,
        renamed[id] ? { ...o, name: renamed[id] } : o,
      ]),
    );
  return {
    ...model,
    constraints: apply(model.constraints),
    indexes: apply(model.indexes),
  };
}
