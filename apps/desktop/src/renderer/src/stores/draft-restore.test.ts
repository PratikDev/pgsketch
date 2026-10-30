import type { Introspection, SchemaModel } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { restoreDraft } from './draft-restore';

const loaded: Introspection = {
  model: fixtureModel,
  casts: { categories: {}, domains: {}, casts: {} },
  fingerprint: 'fp-now',
};
const draftOf = (model: unknown, fingerprint = 'fp-now') => ({
  fingerprint,
  desiredJson: JSON.stringify(model),
});
const edited = (change: (m: SchemaModel) => void): SchemaModel => {
  const model = structuredClone(fixtureModel);
  change(model);
  return model;
};

describe('restoreDraft', () => {
  test('gives back the edited schema of a draft made on this very schema', () => {
    const model = edited((m) => {
      m.columns['c:10:2']!.name = 'state';
      m.tables['new-1'] = {
        id: 'new-1',
        schemaId: 's:1',
        name: 'tags',
        comment: null,
      };
    });
    expect(restoreDraft(draftOf(model), loaded)).toEqual(model);
  });

  test('is nothing when the schema has changed since: another fingerprint', () => {
    expect(restoreDraft(draftOf(fixtureModel, 'fp-before'), loaded)).toBeNull();
  });

  test('is nothing when an object that came from the database is no longer in it, even under the same fingerprint', () => {
    const model = edited((m) => {
      m.tables['t:9999'] = {
        id: 't:9999',
        schemaId: 's:1',
        name: 'ghost',
        comment: null,
      };
    });
    expect(restoreDraft(draftOf(model), loaded)).toBeNull();
    const withColumn = edited((m) => {
      m.columns['c:10:99'] = {
        ...m.columns['c:10:2']!,
        id: 'c:10:99',
      };
    });
    expect(restoreDraft(draftOf(withColumn), loaded)).toBeNull();
  });

  test('objects made in the editor have no place in the database to be missing from', () => {
    const model = edited((m) => {
      m.schemas['9f1c-new'] = { id: '9f1c-new', name: 'audit' };
    });
    expect(restoreDraft(draftOf(model), loaded)).toEqual(model);
  });

  test('an object the user removed is fine: it is the edit', () => {
    const model = edited((m) => void delete m.tables['t:30']);
    expect(restoreDraft(draftOf(model), loaded)).toEqual(model);
  });

  test('is nothing for text that is not a schema model', () => {
    for (const text of [
      'not json',
      '[]',
      'null',
      '{}',
      JSON.stringify({ ...fixtureModel, tables: [] }),
      JSON.stringify({ ...fixtureModel, tables: { 't:1': { id: 'other' } } }),
    ])
      expect(
        restoreDraft({ fingerprint: 'fp-now', desiredJson: text }, loaded),
      ).toBeNull();
  });
});
