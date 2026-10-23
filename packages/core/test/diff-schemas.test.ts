import { expect, test } from 'vitest';
import { diffSchemas } from '../src/diff/schemas';
import { edit } from './diff-helpers';

const run = (change: Parameters<typeof edit>[0]) => {
  const { baseline, desired } = edit(change);
  return diffSchemas(baseline, desired);
};

test('no edits, no operations', () => {
  expect(run(() => {})).toEqual({ ops: [], errors: [] });
});

test('a new schema yields createSchema', () => {
  const { ops, errors } = run((m) => {
    m.schemas['new-schema'] = { id: 'new-schema', name: 'reporting' };
  });
  expect(ops).toEqual([
    { kind: 'createSchema', schema: { id: 'new-schema', name: 'reporting' } },
  ]);
  expect(errors).toEqual([]);
});

test('several new schemas each get an operation', () => {
  const { ops } = run((m) => {
    m.schemas.a = { id: 'a', name: 'a' };
    m.schemas.b = { id: 'b', name: 'b' };
  });
  expect(ops.map((o) => o.kind)).toEqual(['createSchema', 'createSchema']);
});

test('renaming or dropping an existing schema is a blocking error, never silently ignored', () => {
  const renamed = run((m) => (m.schemas['s:2']!.name = 'invoicing'));
  expect(renamed.ops).toEqual([]);
  expect(renamed.errors).toMatchObject([
    { code: 'schema-changed', objectId: 's:2' },
  ]);
  const dropped = run((m) => delete m.schemas['s:2']);
  expect(dropped.errors).toMatchObject([
    { code: 'schema-changed', objectId: 's:2' },
  ]);
});
