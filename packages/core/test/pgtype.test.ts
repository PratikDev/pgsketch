import { expect, test } from 'vitest';
import type { PgType } from '../src/model/types';
import { parsePgType, renderPgType } from '../src/sql/pgtype';

// [format_type output, parsed type, rendered SQL]
const cases: [string, PgType, string][] = [
  ['integer', { name: 'integer', isArray: false }, 'integer'],
  ['text', { name: 'text', isArray: false }, 'text'],
  [
    'double precision',
    { name: 'double precision', isArray: false },
    'double precision',
  ],
  ['"char"', { name: '"char"', isArray: false }, '"char"'],
  [
    'character varying(255)',
    { name: 'varchar', params: [255], isArray: false },
    'varchar(255)',
  ],
  ['character varying', { name: 'varchar', isArray: false }, 'varchar'],
  [
    'character(10)',
    { name: 'bpchar', params: [10], isArray: false },
    'bpchar(10)',
  ],
  [
    'numeric(10,2)',
    { name: 'numeric', params: [10, 2], isArray: false },
    'numeric(10,2)',
  ],
  [
    'numeric(10)',
    { name: 'numeric', params: [10], isArray: false },
    'numeric(10)',
  ],
  [
    'timestamp with time zone',
    { name: 'timestamptz', isArray: false },
    'timestamptz',
  ],
  [
    'timestamp without time zone',
    { name: 'timestamp', isArray: false },
    'timestamp',
  ],
  [
    'timestamp(3) without time zone',
    { name: 'timestamp', params: [3], isArray: false },
    'timestamp(3)',
  ],
  [
    'time(2) with time zone',
    { name: 'timetz', params: [2], isArray: false },
    'timetz(2)',
  ],
  [
    'bit varying(5)',
    { name: 'varbit', params: [5], isArray: false },
    'varbit(5)',
  ],
  [
    'interval day to second(3)',
    { name: 'interval day to second', params: [3], isArray: false },
    'interval day to second(3)',
  ],
  ['text[]', { name: 'text', isArray: true }, 'text[]'],
  ['integer[][]', { name: 'integer', isArray: true }, 'integer[]'],
  [
    'character varying(10)[]',
    { name: 'varchar', params: [10], isArray: true },
    'varchar(10)[]',
  ],
  [
    'numeric(10,2)[]',
    { name: 'numeric', params: [10, 2], isArray: true },
    'numeric(10,2)[]',
  ],
  [
    'public.mood',
    { name: 'mood', schema: 'public', isArray: false },
    '"public"."mood"',
  ],
  [
    'public.mood[]',
    { name: 'mood', schema: 'public', isArray: true },
    '"public"."mood"[]',
  ],
  [
    '"My Schema"."Mood"',
    { name: 'Mood', schema: 'My Schema', isArray: false },
    '"My Schema"."Mood"',
  ],
  [
    'app."odd""name"',
    { name: 'odd"name', schema: 'app', isArray: false },
    '"app"."odd""name"',
  ],
  [
    'public.vector(3)',
    { name: 'vector', schema: 'public', params: [3], isArray: false },
    '"public"."vector"(3)',
  ],
];

test.each(cases)('%s parses and renders', (formatted, type, sql) => {
  expect(parsePgType(formatted)).toEqual(type);
  expect(renderPgType(type)).toBe(sql);
});

test.each([
  '',
  'public.geometry(Point,4326)',
  'character varying(',
  '"unterminated',
  'a.b.c',
])('unparseable type %j throws', (text) => {
  expect(() => parsePgType(text)).toThrow();
});

test('render rejects names and parameters that would not be safe SQL', () => {
  expect(() =>
    renderPgType({ name: 'integer; DROP TABLE x', isArray: false }),
  ).toThrow();
  expect(() => renderPgType({ name: 'Integer', isArray: false })).toThrow();
  expect(() =>
    renderPgType({ name: 'varchar', params: [-1], isArray: false }),
  ).toThrow();
  expect(() =>
    renderPgType({ name: 'varchar', params: [1.5], isArray: false }),
  ).toThrow();
});
