import type { ValidationError } from './errors';
import type { Id, SchemaModel } from './types';
import { utf8Length } from './utf8';

const MAX_IDENTIFIER_BYTES = 63;

interface Named {
  id: Id;
  name: string;
}

function checkNames(
  objects: Named[],
  label: string,
  errors: ValidationError[],
): void {
  for (const { id, name } of objects) {
    if (name === '') {
      errors.push({
        code: 'name-empty',
        objectId: id,
        message: `${label} name is empty`,
      });
    } else if (utf8Length(name) > MAX_IDENTIFIER_BYTES) {
      errors.push({
        code: 'name-too-long',
        objectId: id,
        message: `${label} name "${name}" is longer than ${MAX_IDENTIFIER_BYTES} bytes`,
      });
    }
  }
}

/** Reports every object in a group of two or more that share a name. */
function checkUnique(
  entries: (Named & { scope: Id })[],
  label: string,
  errors: ValidationError[],
): void {
  const groups = new Map<string, Named[]>();
  for (const entry of entries) {
    const key = `${entry.scope}\0${entry.name}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const { id, name } of group) {
      errors.push({
        code: 'name-duplicate',
        objectId: id,
        message: `"${name}" is already used by another ${label}`,
      });
    }
  }
}

export function validateNames(model: SchemaModel): ValidationError[] {
  const errors: ValidationError[] = [];
  const schemas = Object.values(model.schemas);
  const tables = Object.values(model.tables);
  const columns = Object.values(model.columns);
  const constraints = Object.values(model.constraints);
  const indexes = Object.values(model.indexes);

  checkNames(schemas, 'Schema', errors);
  checkNames(tables, 'Table', errors);
  checkNames(columns, 'Column', errors);
  checkNames(constraints, 'Constraint', errors);
  checkNames(indexes, 'Index', errors);

  checkUnique(
    schemas.map((s) => ({ ...s, scope: '' })),
    'schema',
    errors,
  );
  checkUnique(
    columns.map((c) => ({ ...c, scope: c.tableId })),
    'column in this table',
    errors,
  );
  checkUnique(
    constraints.map((c) => ({ ...c, scope: c.tableId })),
    'constraint on this table',
    errors,
  );

  // Tables, indexes, sequences and views share one namespace per schema. PK, unique and
  // exclusion constraints create an index named after the constraint, so they join it.
  const schemaOf = (tableId: Id) => model.tables[tableId]?.schemaId;
  const relations: (Named & { scope: Id })[] = [];
  for (const t of tables) relations.push({ ...t, scope: t.schemaId });
  for (const i of indexes) {
    const scope = schemaOf(i.tableId);
    if (scope) relations.push({ ...i, scope });
  }
  for (const c of constraints) {
    const scope = schemaOf(c.tableId);
    if (
      scope &&
      (c.kind === 'pk' || c.kind === 'unique' || c.kind === 'exclusion')
    ) {
      relations.push({ ...c, scope });
    }
  }
  for (const u of Object.values(model.unmodeled)) {
    if (
      u.schemaId &&
      ['view', 'materialized-view', 'foreign-table', 'sequence'].includes(
        u.kind,
      )
    ) {
      relations.push({ ...u, scope: u.schemaId });
    }
  }
  checkUnique(
    relations,
    'table, index, view or sequence in this schema',
    errors,
  );

  return errors;
}
