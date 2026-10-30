import type { Introspection, SchemaModel } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { classifyDraft } from './draft-restore';

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

const outcome = (draft: { fingerprint: string; desiredJson: string }) =>
  classifyDraft(draft, loaded);

describe('classifyDraft', () => {
  test('restores the edited schema of a draft made on this very schema', () => {
    const model = edited((m) => {
      m.columns['c:10:2']!.name = 'state';
      m.tables['new-1'] = {
        id: 'new-1',
        schemaId: 's:1',
        name: 'tags',
        comment: null,
      };
    });
    expect(outcome(draftOf(model))).toEqual({
      kind: 'restore',
      desired: model,
    });
  });

  test('discards a draft made on another schema, when the database is not what it asked for', () => {
    const model = edited((m) => void (m.columns['c:10:2']!.name = 'state'));
    expect(outcome(draftOf(model, 'fp-before'))).toEqual({ kind: 'discard' });
  });

  test('says the edits were applied when the database changed to just what they asked for', () => {
    // the draft renames a column and adds a table; the database has both now, with ids of its own
    const model = edited((m) => {
      m.columns['c:10:2']!.name = 'state';
      m.tables['uuid-1'] = {
        id: 'uuid-1',
        schemaId: 's:1',
        name: 'tags',
        comment: null,
      };
    });
    const now: Introspection = {
      ...loaded,
      model: edited((m) => {
        m.columns['c:10:2']!.name = 'state';
        m.tables['t:777'] = {
          id: 't:777',
          schemaId: 's:1',
          name: 'tags',
          comment: null,
        };
      }),
      fingerprint: 'fp-after-the-sql',
    };
    expect(classifyDraft(draftOf(model), now)).toEqual({
      kind: 'applied',
      desired: model,
    });
  });

  test('discards the edits when the database changed to something else', () => {
    const model = edited((m) => void (m.columns['c:10:2']!.name = 'state'));
    const now: Introspection = {
      ...loaded,
      model: edited((m) => void (m.columns['c:10:2']!.name = 'other')),
      fingerprint: 'fp-other',
    };
    expect(classifyDraft(draftOf(model), now)).toEqual({ kind: 'discard' });
  });

  test('is not fooled by a fingerprint that is the same when an object from the database is gone', () => {
    const model = edited((m) => {
      m.tables['t:9999'] = {
        id: 't:9999',
        schemaId: 's:1',
        name: 'ghost',
        comment: null,
      };
    });
    expect(outcome(draftOf(model))).toEqual({ kind: 'discard' });
    const withColumn = edited((m) => {
      m.columns['c:10:99'] = { ...m.columns['c:10:2']!, id: 'c:10:99' };
    });
    expect(outcome(draftOf(withColumn))).toEqual({ kind: 'discard' });
  });

  test('objects made in the editor have no place in the database to be missing from', () => {
    const model = edited((m) => {
      m.schemas['9f1c-new'] = { id: '9f1c-new', name: 'audit' };
    });
    expect(outcome(draftOf(model))).toEqual({
      kind: 'restore',
      desired: model,
    });
  });

  test('an object the user removed is fine: it is the edit', () => {
    const model = edited((m) => void delete m.tables['t:30']);
    expect(outcome(draftOf(model))).toEqual({
      kind: 'restore',
      desired: model,
    });
  });

  test('discards text that is not a schema model', () => {
    for (const text of [
      'not json',
      '[]',
      'null',
      '{}',
      JSON.stringify({ ...fixtureModel, tables: [] }),
      JSON.stringify({ ...fixtureModel, tables: { 't:1': { id: 'other' } } }),
    ])
      expect(outcome({ fingerprint: 'fp-now', desiredJson: text })).toEqual({
        kind: 'discard',
      });
  });
});
