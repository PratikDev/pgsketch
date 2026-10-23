import { fkTypesCompatible } from './fk-types';
import type { ValidationError } from './errors';
import type { Column, Constraint, Id, Index, SchemaModel } from './types';
import { validateNames } from './validate-names';

/** Index kinds an FK can't reference: partial, expression and non-B-tree unique indexes. */
const UNUSABLE_FK_INDEX = [
  'partial-index',
  'expression-index',
  'non-btree-index',
];

const sameSet = (a: Id[], b: Id[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

function checkTypeParams(column: Column, errors: ValidationError[]): void {
  const [first, second] = column.type.params ?? [];
  const name = column.type.schema === undefined ? column.type.name : '';
  const bad = (message: string) =>
    errors.push({ code: 'invalid-type-params', objectId: column.id, message });
  if (
    ['varchar', 'bpchar', 'bit', 'varbit'].includes(name) &&
    first !== undefined &&
    first < 1
  ) {
    bad(`${name} length must be greater than 0`);
  }
  if (name === 'numeric' && first !== undefined) {
    if (first < 1) bad('numeric precision must be greater than 0');
    else if (second !== undefined && second > first)
      bad('numeric scale cannot exceed precision');
  }
}

function checkForeignKey(
  fk: Extract<Constraint, { kind: 'fk' }>,
  model: SchemaModel,
  errors: ValidationError[],
): void {
  if (fk.columnIds.length !== fk.refColumnIds.length) {
    errors.push({
      code: 'fk-column-count',
      objectId: fk.id,
      message:
        'A foreign key needs as many referenced columns as local columns',
    });
    return;
  }

  const keys: { columns: Id[]; loose: boolean }[] = [];
  for (const c of Object.values(model.constraints)) {
    // Deferrable keys can't be referenced.
    if (
      c.tableId === fk.refTableId &&
      (c.kind === 'pk' || c.kind === 'unique') &&
      c.readOnly !== 'deferrable'
    ) {
      keys.push({ columns: c.columnIds, loose: false });
    }
  }
  for (const i of Object.values(model.indexes)) {
    if (
      i.tableId !== fk.refTableId ||
      !i.unique ||
      UNUSABLE_FK_INDEX.includes(i.readOnly ?? '')
    )
      continue;
    // Read-only indexes list every column they touch, INCLUDE columns too, so only require a subset.
    keys.push({ columns: i.columnIds, loose: i.readOnly !== undefined });
  }
  const covered = keys.some((k) =>
    k.loose
      ? fk.refColumnIds.every((id) => k.columns.includes(id))
      : sameSet(k.columns, fk.refColumnIds),
  );
  if (!covered) {
    errors.push({
      code: 'fk-no-target',
      objectId: fk.id,
      message: 'The referenced columns need a primary key or unique constraint',
    });
  }

  fk.columnIds.forEach((id, i) => {
    const local = model.columns[id];
    const ref = model.columns[fk.refColumnIds[i]!];
    if (local && ref && !fkTypesCompatible(local.type, ref.type)) {
      errors.push({
        code: 'fk-type-mismatch',
        objectId: fk.id,
        message: `Column "${local.name}" can't reference "${ref.name}": the types are incompatible`,
      });
    }
  });
}

/** Whether every id is a column of `tableId`. */
function columnsExist(ids: Id[], tableId: Id, model: SchemaModel): boolean {
  return ids.every((id) => model.columns[id]?.tableId === tableId);
}

function checkConstraintsAndIndexes(
  model: SchemaModel,
  errors: ValidationError[],
): void {
  const missingColumn = (object: Constraint | Index, message: string) =>
    errors.push({ code: 'missing-column', objectId: object.id, message });

  for (const c of Object.values(model.constraints)) {
    if (!columnsExist(c.columnIds, c.tableId, model)) {
      missingColumn(
        c,
        `Constraint "${c.name}" uses a column that no longer exists`,
      );
      continue;
    }
    if (c.kind !== 'fk') continue;
    if (!model.tables[c.refTableId]) {
      errors.push({
        code: 'missing-ref-table',
        objectId: c.id,
        message: `Foreign key "${c.name}" references a table that no longer exists`,
      });
    } else if (!columnsExist(c.refColumnIds, c.refTableId, model)) {
      missingColumn(
        c,
        `Foreign key "${c.name}" references a column that no longer exists`,
      );
    } else if (!c.readOnly) {
      checkForeignKey(c, model, errors);
    }
  }
  for (const i of Object.values(model.indexes)) {
    if (!columnsExist(i.columnIds, i.tableId, model)) {
      missingColumn(i, `Index "${i.name}" uses a column that no longer exists`);
    }
  }
}

export function validateModel(model: SchemaModel): ValidationError[] {
  const errors = validateNames(model);

  for (const table of Object.values(model.tables)) {
    if (!model.schemas[table.schemaId]) {
      errors.push({
        code: 'missing-schema',
        objectId: table.id,
        message: `Table "${table.name}" is in a schema that doesn't exist`,
      });
    }
  }

  const pkCount = new Map<Id, number>();
  const pkColumns = new Set<Id>();
  for (const c of Object.values(model.constraints)) {
    if (c.kind !== 'pk') continue;
    pkCount.set(c.tableId, (pkCount.get(c.tableId) ?? 0) + 1);
    c.columnIds.forEach((id) => pkColumns.add(id));
  }
  for (const [tableId, count] of pkCount) {
    if (count > 1) {
      errors.push({
        code: 'multiple-primary-keys',
        objectId: tableId,
        message: 'A table can have only one primary key',
      });
    }
  }

  for (const column of Object.values(model.columns)) {
    if (pkColumns.has(column.id) && !column.notNull) {
      errors.push({
        code: 'pk-nullable',
        objectId: column.id,
        message: `Primary key column "${column.name}" must be NOT NULL`,
      });
    }
    if (column.identity && !column.notNull) {
      errors.push({
        code: 'identity-nullable',
        objectId: column.id,
        message: `Identity column "${column.name}" must be NOT NULL`,
      });
    }
    if (column.identity && column.default) {
      errors.push({
        code: 'identity-default',
        objectId: column.id,
        message: `Identity column "${column.name}" can't have a default`,
      });
    }
    checkTypeParams(column, errors);
  }

  checkConstraintsAndIndexes(model, errors);
  return errors;
}
