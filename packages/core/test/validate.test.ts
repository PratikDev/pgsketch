import { describe, expect, test } from 'vitest';
import type {
  Column,
  Constraint,
  Index,
  PgType,
  SchemaModel,
  Table,
} from '../src/index';
import { validateModel } from '../src/index';
import { fixtureModel } from './fixtures/model';

const base = (): SchemaModel => structuredClone(fixtureModel);

/** Applies `change` to a copy of the fixture and returns `code@objectId` for each error. */
function errorsAfter(change: (m: SchemaModel) => void): string[] {
  const model = base();
  change(model);
  return validateModel(model).map((e) => `${e.code}@${e.objectId}`);
}

const int8: PgType = { name: 'bigint', isArray: false };
const table = (id: string, name: string, schemaId = 's:1'): Table => ({
  id,
  schemaId,
  name,
  comment: null,
});
const column = (
  id: string,
  tableId: string,
  name: string,
  over: Partial<Column> = {},
): Column => ({
  id,
  tableId,
  name,
  position: 1,
  type: int8,
  notNull: false,
  default: null,
  identity: null,
  comment: null,
  ...over,
});
const unique = (
  id: string,
  tableId: string,
  name: string,
  columnIds: string[],
): Constraint => ({
  id,
  tableId,
  name,
  kind: 'unique',
  columnIds,
});
const index = (
  id: string,
  tableId: string,
  name: string,
  over: Partial<Index> = {},
): Index => ({
  id,
  tableId,
  name,
  unique: false,
  columnIds: [],
  ...over,
});
const fk = (
  columnIds: string[],
  refColumnIds: string[],
  refTableId = 't:40',
): Constraint => ({
  id: 'k:fk',
  tableId: 't:50',
  kind: 'fk',
  name: 'child_fkey',
  columnIds,
  refTableId,
  refColumnIds,
  onDelete: 'no action',
  onUpdate: 'no action',
});

/** Adds a parent table `t:40` (columns a, b) and a child table `t:50` (columns x, y) with the given FK. */
function withFkTables(
  m: SchemaModel,
  foreignKey: Constraint,
  parentKeys: (Constraint | Index)[] = [],
) {
  m.tables['t:40'] = table('t:40', 'parent');
  m.tables['t:50'] = table('t:50', 'child');
  for (const [id, name, tableId] of [
    ['c:40:a', 'a', 't:40'],
    ['c:40:b', 'b', 't:40'],
    ['c:50:x', 'x', 't:50'],
    ['c:50:y', 'y', 't:50'],
  ] as const) {
    m.columns[id] = column(id, tableId, name, { notNull: id === 'c:40:a' });
  }
  m.constraints[foreignKey.id] = foreignKey;
  for (const key of parentKeys) {
    if ('kind' in key) m.constraints[key.id] = key;
    else m.indexes[key.id] = key;
  }
}

test('the fixture model is valid', () => {
  expect(errorsAfter(() => {})).toEqual([]);
});

describe('names (B5)', () => {
  test('empty names are rejected', () => {
    expect(errorsAfter((m) => (m.tables['t:10']!.name = ''))).toEqual([
      'name-empty@t:10',
    ]);
  });

  test('names over 63 bytes are rejected, counting bytes not characters', () => {
    const rename = (name: string) =>
      errorsAfter((m) => (m.tables['t:10']!.name = name));
    expect(rename('a'.repeat(63))).toEqual([]);
    expect(rename('a'.repeat(64))).toEqual(['name-too-long@t:10']);
    expect(rename('é'.repeat(31))).toEqual([]);
    expect(rename('é'.repeat(32))).toEqual(['name-too-long@t:10']);
  });

  test('an index named like a table in the same schema fails', () => {
    const errors = errorsAfter((m) => (m.indexes['i:1']!.name = 'invoices'));
    expect(errors.sort()).toEqual([
      'name-duplicate@i:1',
      'name-duplicate@t:20',
    ]);
  });

  test('the same name in different schemas is fine', () => {
    expect(errorsAfter((m) => (m.indexes['i:1']!.name = 'users'))).toEqual([]);
  });

  test('two tables can use the same check constraint name', () => {
    const errors = errorsAfter((m) => {
      m.tables['t:40'] = table('t:40', 'other');
      m.columns['c:40:1'] = column('c:40:1', 't:40', 'n');
      m.constraints['k:40'] = {
        id: 'k:40',
        tableId: 't:40',
        kind: 'check',
        name: 'invoices_total_check',
        columnIds: ['c:40:1'],
        expression: '(n > 0)',
      };
    });
    expect(errors).toEqual([]);
  });

  test('constraint names must be unique per table, across kinds', () => {
    const errors = errorsAfter(
      (m) => (m.constraints['k:2']!.name = 'invoices_total_check'),
    );
    expect(errors.sort()).toEqual(['name-duplicate@k:2', 'name-duplicate@k:3']);
  });

  test('PK, unique and exclusion constraints share the relation namespace', () => {
    expect(
      errorsAfter((m) => (m.constraints['k:1']!.name = 'events')).sort(),
    ).toEqual(['name-duplicate@k:1', 'name-duplicate@t:30']);
    expect(
      errorsAfter(
        (m) => (m.constraints['k:4']!.name = 'invoices_user_id_idx'),
      ).sort(),
    ).toEqual(['name-duplicate@i:1', 'name-duplicate@k:4']);
  });

  test('views and sequences share the relation namespace', () => {
    const errors = errorsAfter((m) => (m.unmodeled['u:1']!.name = 'invoices'));
    expect(errors.sort()).toEqual([
      'name-duplicate@t:20',
      'name-duplicate@u:1',
    ]);
  });

  test('column names are unique per table only', () => {
    expect(
      errorsAfter((m) => (m.columns['c:20:3']!.name = 'user_id')).sort(),
    ).toEqual(['name-duplicate@c:20:2', 'name-duplicate@c:20:3']);
    expect(errorsAfter((m) => (m.columns['c:20:3']!.name = 'status'))).toEqual(
      [],
    );
  });

  test('schema names are unique', () => {
    const errors = errorsAfter((m) => (m.schemas['s:2']!.name = 'public'));
    expect(errors.sort()).toEqual(['name-duplicate@s:1', 'name-duplicate@s:2']);
  });
});

describe('structure (B6)', () => {
  test('a table can have only one primary key', () => {
    const errors = errorsAfter((m) => {
      m.constraints['k:9'] = {
        id: 'k:9',
        tableId: 't:10',
        kind: 'pk',
        name: 'users_pk2',
        columnIds: ['c:10:1'],
      };
    });
    expect(errors).toEqual(['multiple-primary-keys@t:10']);
  });

  test('primary key columns must be NOT NULL', () => {
    expect(
      errorsAfter((m) => (m.columns['c:10:1']!.notNull = false)),
    ).toContain('pk-nullable@c:10:1');
  });

  test('identity columns must be NOT NULL and have no default', () => {
    const errors = errorsAfter((m) => {
      m.columns['c:10:1']!.notNull = false;
      m.columns['c:10:1']!.default = { kind: 'constant', expression: '1' };
    });
    expect(errors.sort()).toEqual([
      'identity-default@c:10:1',
      'identity-nullable@c:10:1',
      'pk-nullable@c:10:1',
    ]);
  });

  test('an index or constraint on a removed column fails', () => {
    const errors = errorsAfter((m) => delete m.columns['c:20:2']);
    expect(errors.sort()).toEqual([
      'missing-column@i:1',
      'missing-column@k:2',
      'missing-column@k:4',
    ]);
  });

  test('an FK to a removed table or column fails', () => {
    expect(errorsAfter((m) => delete m.tables['t:10'])).toContain(
      'missing-ref-table@k:2',
    );
    expect(errorsAfter((m) => delete m.columns['c:10:1'])).toContain(
      'missing-column@k:2',
    );
  });

  test('a table in a missing schema fails; a schema created in the same migration is fine', () => {
    expect(
      errorsAfter((m) => (m.tables['t:10']!.schemaId = 'new-schema')),
    ).toEqual(['missing-schema@t:10']);
    expect(
      errorsAfter((m) => {
        m.schemas['new-schema'] = { id: 'new-schema', name: 'fresh' };
        m.tables['t:10']!.schemaId = 'new-schema';
      }),
    ).toEqual([]);
  });

  test('type parameters are checked', () => {
    const typed = (type: PgType) =>
      errorsAfter((m) => (m.columns['c:10:2']!.type = type));
    expect(typed({ name: 'varchar', params: [255], isArray: false })).toEqual(
      [],
    );
    expect(typed({ name: 'varchar', params: [0], isArray: false })).toEqual([
      'invalid-type-params@c:10:2',
    ]);
    expect(typed({ name: 'numeric', params: [10, 2], isArray: false })).toEqual(
      [],
    );
    expect(typed({ name: 'numeric', params: [5, 6], isArray: false })).toEqual([
      'invalid-type-params@c:10:2',
    ]);
    expect(typed({ name: 'numeric', params: [0], isArray: false })).toEqual([
      'invalid-type-params@c:10:2',
    ]);
    expect(
      typed({ name: 'varchar', schema: 'app', params: [0], isArray: false }),
    ).toEqual([]);
  });
});

describe('foreign keys (B6)', () => {
  const parentPk: Constraint = {
    id: 'k:pk',
    tableId: 't:40',
    kind: 'pk',
    name: 'parent_pkey',
    columnIds: ['c:40:a'],
  };
  const errorsFor = (
    foreignKey: Constraint,
    keys: (Constraint | Index)[],
    extra?: (m: SchemaModel) => void,
  ) =>
    errorsAfter((m) => {
      withFkTables(m, foreignKey, keys);
      extra?.(m);
    });

  test('referencing a primary key or unique constraint passes', () => {
    expect(errorsFor(fk(['c:50:x'], ['c:40:a']), [parentPk])).toEqual([]);
    expect(
      errorsFor(fk(['c:50:x'], ['c:40:a']), [
        unique('k:u', 't:40', 'parent_a_key', ['c:40:a']),
      ]),
    ).toEqual([]);
  });

  test('a composite FK matches its key regardless of column order', () => {
    const key = unique('k:u', 't:40', 'parent_ab_key', ['c:40:a', 'c:40:b']);
    expect(
      errorsFor(fk(['c:50:x', 'c:50:y'], ['c:40:b', 'c:40:a']), [key]),
    ).toEqual([]);
  });

  test('referencing columns without a key fails', () => {
    expect(errorsFor(fk(['c:50:x'], ['c:40:b']), [parentPk])).toEqual([
      'fk-no-target@k:fk',
    ]);
    expect(
      errorsFor(fk(['c:50:x', 'c:50:y'], ['c:40:a', 'c:40:b']), [parentPk]),
    ).toEqual(['fk-no-target@k:fk']);
  });

  test('a deferrable unique constraint is not a valid target', () => {
    const deferrable: Constraint = {
      ...unique('k:u', 't:40', 'parent_a_key', ['c:40:a']),
      readOnly: 'deferrable',
    };
    expect(errorsFor(fk(['c:50:x'], ['c:40:a']), [deferrable])).toEqual([
      'fk-no-target@k:fk',
    ]);
  });

  test('FK onto a partial unique index fails; onto a plain unique index passes', () => {
    const plain = index('i:u', 't:40', 'parent_a_idx', {
      unique: true,
      columnIds: ['c:40:a'],
    });
    const partial = { ...plain, readOnly: 'partial-index' as const };
    expect(errorsFor(fk(['c:50:x'], ['c:40:a']), [plain])).toEqual([]);
    expect(errorsFor(fk(['c:50:x'], ['c:40:a']), [partial])).toEqual([
      'fk-no-target@k:fk',
    ]);
  });

  test('a non-unique index is not a target', () => {
    const plain = index('i:u', 't:40', 'parent_a_idx', {
      columnIds: ['c:40:a'],
    });
    expect(errorsFor(fk(['c:50:x'], ['c:40:a']), [plain])).toEqual([
      'fk-no-target@k:fk',
    ]);
  });

  test('the number of columns must match', () => {
    expect(errorsFor(fk(['c:50:x', 'c:50:y'], ['c:40:a']), [parentPk])).toEqual(
      ['fk-column-count@k:fk'],
    );
  });

  test('column types must be compatible', () => {
    const uuid: PgType = { name: 'uuid', isArray: false };
    const mismatch = (change: (m: SchemaModel) => void) =>
      errorsFor(fk(['c:50:x'], ['c:40:a']), [parentPk], change);
    expect(mismatch((m) => (m.columns['c:50:x']!.type = uuid))).toEqual([
      'fk-type-mismatch@k:fk',
    ]);
    expect(
      mismatch(
        (m) =>
          (m.columns['c:50:x']!.type = { name: 'integer', isArray: false }),
      ),
    ).toEqual([]);
    expect(
      mismatch(
        (m) => (m.columns['c:40:a']!.type = { name: 'text', isArray: false }),
      ),
    ).toEqual(['fk-type-mismatch@k:fk']);
    expect(
      mismatch((m) => {
        m.columns['c:40:a']!.type = { name: 'text', isArray: false };
        m.columns['c:50:x']!.type = {
          name: 'varchar',
          params: [20],
          isArray: false,
        };
      }),
    ).toEqual([]);
  });

  test('a self-referencing FK is allowed', () => {
    const selfFk: Constraint = {
      ...fk(['c:40:b'], ['c:40:a'], 't:40'),
      tableId: 't:40',
    };
    expect(errorsFor(selfFk, [parentPk])).toEqual([]);
  });

  test('read-only FKs are preserved as they are, not re-validated', () => {
    const preserved: Constraint = {
      ...fk(['c:50:x'], ['c:40:b']),
      readOnly: 'match-full',
    };
    expect(errorsFor(preserved, [parentPk])).toEqual([]);
  });
});
