import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { tableIdMap } from './table-remap';

describe('tableIdMap', () => {
  test('is empty when every table has the id it has in the other model', () => {
    expect(tableIdMap(fixtureModel, fixtureModel)).toEqual({});
  });

  test('maps a table made in the editor to the one the database made, by schema and name', () => {
    const from = structuredClone(fixtureModel);
    from.tables['9f1c'] = {
      id: '9f1c',
      schemaId: 's:1',
      name: 'tags',
      comment: null,
    };
    const to = structuredClone(fixtureModel);
    to.tables['t:777'] = {
      id: 't:777',
      schemaId: 's:1',
      name: 'tags',
      comment: null,
    };
    expect(tableIdMap(from, to)).toEqual({ '9f1c': 't:777' });
  });

  test('goes by the names of the schemas, not their ids, so a schema made too is found', () => {
    const from = structuredClone(fixtureModel);
    from.schemas['uuid-s'] = { id: 'uuid-s', name: 'audit' };
    from.tables['uuid-t'] = {
      id: 'uuid-t',
      schemaId: 'uuid-s',
      name: 'log',
      comment: null,
    };
    const to = structuredClone(fixtureModel);
    to.schemas['s:900'] = { id: 's:900', name: 'audit' };
    to.tables['t:901'] = {
      id: 't:901',
      schemaId: 's:900',
      name: 'log',
      comment: null,
    };
    expect(tableIdMap(from, to)).toEqual({ 'uuid-t': 't:901' });
  });

  test('leaves out a table that is not in the other model, or is in another schema', () => {
    const from = structuredClone(fixtureModel);
    from.tables['a'] = {
      id: 'a',
      schemaId: 's:1',
      name: 'tags',
      comment: null,
    };
    from.tables['b'] = {
      id: 'b',
      schemaId: 's:1',
      name: 'gone',
      comment: null,
    };
    const to = structuredClone(fixtureModel);
    to.tables['t:5'] = {
      id: 't:5',
      schemaId: 's:2',
      name: 'tags',
      comment: null,
    };
    expect(tableIdMap(from, to)).toEqual({});
  });
});
