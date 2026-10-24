import { expect, test } from 'vitest';
import { renderSchemaOp } from '../src/render/schemas';

const create = (name: string) =>
  renderSchemaOp({ kind: 'createSchema', schema: { id: 'new', name } });

test('a new schema is created', () => {
  expect(create('reporting')).toEqual(['CREATE SCHEMA "reporting"']);
});

test('names are always quoted, whatever they contain', () => {
  expect(create('user')).toEqual(['CREATE SCHEMA "user"']); // a reserved word
  expect(create('My Schema')).toEqual(['CREATE SCHEMA "My Schema"']);
  expect(create('say "hi"')).toEqual(['CREATE SCHEMA "say ""hi"""']);
  expect(create('café 😀')).toEqual(['CREATE SCHEMA "café 😀"']);
});

test('an empty name is refused rather than rendered', () => {
  expect(() => create('')).toThrow();
});
