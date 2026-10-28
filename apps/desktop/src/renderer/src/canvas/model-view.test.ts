import type { PgType, SchemaModel } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { tableViews, typeLabel, unionOf } from './model-view';

const edited = (change: (m: SchemaModel) => void): SchemaModel => {
  const model = structuredClone(fixtureModel);
  change(model);
  return model;
};

describe('unionOf', () => {
  test('is the loaded schema when nothing was edited', () => {
    expect(unionOf(fixtureModel, structuredClone(fixtureModel))).toEqual(
      fixtureModel,
    );
  });

  test('keeps what was removed, from the loaded schema', () => {
    const desired = edited((m) => {
      delete m.tables['t:10'];
      delete m.columns['c:10:1'];
    });
    const union = unionOf(fixtureModel, desired);
    expect(union.tables['t:10']).toEqual(fixtureModel.tables['t:10']);
    expect(union.columns['c:10:1']).toEqual(fixtureModel.columns['c:10:1']);
  });

  test('takes what was edited, and what was added, from the edited schema', () => {
    const desired = edited((m) => {
      m.tables['t:10']!.name = 'people';
      m.tables['new'] = {
        id: 'new',
        schemaId: 's:1',
        name: 'audit',
        comment: null,
      };
      m.schemas['new-s'] = { id: 'new-s', name: 'extra' };
    });
    const union = unionOf(fixtureModel, desired);
    expect(union.tables['t:10']!.name).toBe('people');
    expect(union.tables['new']!.name).toBe('audit');
    expect(union.schemas['new-s']!.name).toBe('extra');
    expect(Object.keys(union.tables).sort()).toEqual([
      'new',
      't:10',
      't:20',
      't:30',
    ]);
  });

  test('does not change either model', () => {
    const desired = edited((m) => delete m.tables['t:10']);
    unionOf(fixtureModel, desired);
    expect(desired.tables['t:10']).toBeUndefined();
    expect(fixtureModel.tables['t:10']).toBeDefined();
  });
});

describe('typeLabel', () => {
  test.each<[PgType, string]>([
    [{ name: 'text', isArray: false }, 'text'],
    [{ name: 'numeric', params: [10, 2], isArray: false }, 'numeric(10,2)'],
    [{ name: 'int4', isArray: true }, 'int4[]'],
    [{ name: 'user_status', schema: 'public', isArray: false }, 'user_status'],
    [{ name: 'mood', schema: 'app', isArray: false }, 'app.mood'],
    [{ name: 'varchar', params: [80], isArray: true }, 'varchar(80)[]'],
  ])('%j reads %s', (type, label) => {
    expect(typeLabel(type)).toBe(label);
  });
});

describe('tableViews', () => {
  const views = tableViews(fixtureModel);
  const users = views.find((t) => t.name === 'users')!;
  const invoices = views.find((t) => t.name === 'invoices')!;

  test('lists every table, in schema and table name order', () => {
    expect(views.map((t) => `${t.schema}.${t.name}`)).toEqual([
      'billing.invoices',
      'public.events',
      'public.users',
    ]);
  });

  test('lists the columns in table order, with their types', () => {
    expect(users.columns.map((c) => [c.name, c.type])).toEqual([
      ['id', 'int8'],
      ['status', 'user_status'],
    ]);
  });

  test('marks primary key, NOT NULL and unique', () => {
    expect(users.columns[0]).toMatchObject({
      primaryKey: true,
      notNull: true,
      unique: false,
    });
    const unique = tableViews(
      edited((m) => {
        m.constraints['u:1'] = {
          id: 'u:1',
          tableId: 't:20',
          kind: 'unique',
          name: 'u',
          columnIds: ['c:20:3'],
        };
        m.constraints['u:2'] = {
          id: 'u:2',
          tableId: 't:20',
          kind: 'unique',
          name: 'u2',
          columnIds: ['c:20:2', 'c:20:3'],
        };
      }),
    ).find((t) => t.name === 'invoices')!;
    expect(unique.columns.find((c) => c.name === 'total')!.unique).toBe(true);
    expect(unique.columns.find((c) => c.name === 'user_id')!.unique).toBe(
      false,
    ); // only in a composite
  });

  test('gives the default, or none', () => {
    expect(users.columns[1]!.default).toBe("'active'::user_status");
    expect(users.columns[0]!.default).toBeNull();
    expect(invoices.columns.find((c) => c.name === 'total')!.default).toBe('0');
  });

  test('gives where a foreign key points, with the schema only when it is another one', () => {
    expect(
      invoices.columns.find((c) => c.name === 'user_id')!.references,
    ).toEqual(['public.users.id']);
    const self = tableViews(
      edited((m) => {
        m.constraints['k:self'] = {
          id: 'k:self',
          tableId: 't:10',
          kind: 'fk',
          name: 'self',
          columnIds: ['c:10:2'],
          refTableId: 't:10',
          refColumnIds: ['c:10:1'],
          onDelete: 'no action',
          onUpdate: 'no action',
        };
      }),
    ).find((t) => t.name === 'users')!;
    expect(self.columns[1]!.references).toEqual(['users.id']);
    expect(users.columns[0]!.references).toEqual([]);
  });

  test('a composite foreign key points each column at its own target', () => {
    const model = edited((m) => {
      m.constraints['k:2'] = {
        ...(m.constraints['k:2'] as Extract<
          (typeof m.constraints)[string],
          { kind: 'fk' }
        >),
        columnIds: ['c:20:2', 'c:20:3'],
        refColumnIds: ['c:10:1', 'c:10:2'],
      };
    });
    const t = tableViews(model).find((v) => v.name === 'invoices')!;
    expect(t.columns.find((c) => c.name === 'user_id')!.references).toEqual([
      'public.users.id',
    ]);
    expect(t.columns.find((c) => c.name === 'total')!.references).toEqual([
      'public.users.status',
    ]);
  });
});
