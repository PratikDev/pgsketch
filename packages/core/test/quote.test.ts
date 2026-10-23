import { expect, test } from 'vitest';
import { qualified, quoteIdent, quoteLiteral } from '../src/sql/quote';

test.each([
  ['users', '"users"'],
  ['Users', '"Users"'],
  ['select', '"select"'],
  ['order', '"order"'],
  ['has space', '"has space"'],
  ['say "hi"', '"say ""hi"""'],
  ['""', '""""""'],
  ['café', '"café"'],
  ['表', '"表"'],
  ['😀', '"😀"'],
])('quoteIdent(%j) = %s', (input, expected) => {
  expect(quoteIdent(input)).toBe(expected);
});

test.each([
  ['hello', "'hello'"],
  ["it's", "'it''s'"],
  ["''", "''''''"],
  ['', "''"],
  ['café 😀', "'café 😀'"],
  ['a\\b', "E'a\\\\b'"],
  ["a\\'b", "E'a\\\\''b'"],
  ['line\nbreak', "'line\nbreak'"],
])('quoteLiteral(%j) = %s', (input, expected) => {
  expect(quoteLiteral(input)).toBe(expected);
});

test('empty identifiers and NUL characters are rejected', () => {
  expect(() => quoteIdent('')).toThrow();
  expect(() => quoteIdent('a\0b')).toThrow();
  expect(() => quoteLiteral('a\0b')).toThrow();
});

test('qualified quotes both parts', () => {
  expect(qualified('billing', 'invoices')).toBe('"billing"."invoices"');
  expect(qualified('My "Schema"', 'order')).toBe('"My ""Schema"""."order"');
});
