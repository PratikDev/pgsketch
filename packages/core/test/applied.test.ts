import { describe, expect, test } from 'vitest';
import { firstDifference, matchesByName } from '../src/diff/applied';
import type { SchemaModel } from '../src/model/types';
import { fixtureModel } from './fixtures/model';

/** The same schema as it would load again: every id different, nothing else. */
function reloaded(model: SchemaModel): SchemaModel {
  const ids = Object.values(model).flatMap((objects) => Object.keys(objects));
  const json = ids.reduce(
    (text, id) =>
      text.replaceAll(JSON.stringify(id), JSON.stringify(`new-${id}`)),
    JSON.stringify(model),
  );
  return JSON.parse(json) as SchemaModel;
}

const edited = (change: (model: SchemaModel) => void): SchemaModel => {
  const model = structuredClone(fixtureModel);
  change(model);
  return model;
};

const differs = (change: (model: SchemaModel) => void): string | null =>
  firstDifference(edited(change), fixtureModel);

describe('matching by name', () => {
  test('the same schema with different ids matches', () => {
    const other = reloaded(fixtureModel);
    expect(Object.keys(other.tables)).toEqual([
      'new-t:10',
      'new-t:20',
      'new-t:30',
    ]);
    expect(firstDifference(other, fixtureModel)).toBeNull();
    expect(matchesByName(other, fixtureModel)).toBe(true);
  });

  test('one extra column does not match, and the message says where', () => {
    const message = differs((m) => {
      m.columns['c:10:9'] = {
        ...m.columns['c:10:2']!,
        id: 'c:10:9',
        name: 'extra',
        position: 3,
      };
    });
    expect(message).toMatch(/^Different column order of "public"\."users"/);
    expect(
      matchesByName(
        edited((m) => delete m.columns['c:10:2']),
        fixtureModel,
      ),
    ).toBe(false);
  });

  test('gaps in the position numbers do not matter, the order does', () => {
    expect(
      differs((m) => {
        m.columns['c:10:1']!.position = 5;
        m.columns['c:10:2']!.position = 9;
      }),
    ).toBeNull();
    expect(
      differs((m) => {
        m.columns['c:10:1']!.position = 9;
      }),
    ).toMatch(/^Different column order of "public"\."users"/);
  });

  test('a missing or extra object is named', () => {
    const addExtra = (m: SchemaModel) => {
      m.schemas['s:3'] = { id: 's:3', name: 'extra' };
      m.tables['t:40'] = {
        id: 't:40',
        schemaId: 's:3',
        name: 'things',
        comment: null,
      };
    };
    expect(differs(addExtra)).toBe('Unexpected schema "extra"');
    expect(firstDifference(fixtureModel, edited(addExtra))).toBe(
      'Missing schema "extra"',
    );
    expect(
      differs((m) => {
        m.tables['t:40'] = { ...m.tables['t:10']!, id: 't:40', name: 'things' };
      }),
    ).toBe('Unexpected table "public"."things"');
  });

  test.each([
    ['a table comment', (m: SchemaModel) => (m.tables['t:10']!.comment = 'x')],
    [
      'a column type',
      (m: SchemaModel) => (m.columns['c:10:1']!.type.name = 'int4'),
    ],
    [
      'a column default',
      (m: SchemaModel) => (m.columns['c:10:2']!.default = null),
    ],
    ['nullability', (m: SchemaModel) => (m.columns['c:10:1']!.notNull = false)],
    [
      'a column name',
      (m: SchemaModel) => (m.columns['c:10:2']!.name = 'state'),
    ],
    ['a table name', (m: SchemaModel) => (m.tables['t:10']!.name = 'people')],
    [
      'a read-only reason',
      (m: SchemaModel) => (m.tables['t:30']!.readOnly = 'partition'),
    ],
  ])('%s is a difference', (_, change) => {
    expect(differs(change)).not.toBeNull();
  });

  test('constraints, indexes and enums are compared by name and definition', () => {
    const constraint = Object.values(fixtureModel.constraints)[0]!;
    const index = Object.values(fixtureModel.indexes)[0]!;
    const enumType = Object.values(fixtureModel.enums)[0]!;
    expect(
      differs((m) => (m.constraints[constraint.id]!.name = 'renamed')),
    ).not.toBeNull();
    expect(
      differs((m) => (m.indexes[index.id]!.name = 'renamed')),
    ).not.toBeNull();
    expect(
      differs((m) => (m.indexes[index.id]!.unique = !index.unique)),
    ).not.toBeNull();
    expect(
      differs((m) => m.enums[enumType.id]!.labels.reverse()),
    ).not.toBeNull();
    expect(differs((m) => delete m.constraints[constraint.id])).toMatch(
      /^Missing constraint/,
    );
  });

  test('a foreign key is compared by the table and columns it points at', () => {
    const fk = Object.values(fixtureModel.constraints).find(
      (c) => c.kind === 'fk',
    )!;
    expect(
      differs((m) => {
        const copy = m.constraints[fk.id];
        if (copy?.kind === 'fk') copy.onDelete = 'set null';
      }),
    ).toMatch(/^Different constraint/);
  });

  test('unmodeled objects are ignored', () => {
    expect(differs((m) => (m.unmodeled = {}))).toBeNull();
    expect(Object.keys(fixtureModel.unmodeled).length).toBeGreaterThan(0);
  });
});
