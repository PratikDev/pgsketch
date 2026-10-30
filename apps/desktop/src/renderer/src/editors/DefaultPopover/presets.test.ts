import type { PgType } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { constantExpression, presetsFor } from './presets';

const type = (name: string, over: Partial<PgType> = {}): PgType => ({
  name,
  isArray: false,
  ...over,
});
const sql = (t: PgType, labels?: string[]) =>
  presetsFor(t, labels).map((p) => p.expression);

describe('presetsFor', () => {
  test('offers what makes sense for each kind of type', () => {
    expect(sql(type('integer'))).toEqual(['0']);
    expect(sql(type('numeric', { params: [10, 2] }))).toEqual(['0']);
    expect(sql(type('boolean'))).toEqual(['false', 'true']);
    expect(sql(type('text'))).toEqual(["''"]);
    expect(sql(type('varchar', { params: [20] }))).toEqual(["''"]);
    expect(sql(type('uuid'))).toEqual(['gen_random_uuid()']);
    expect(sql(type('timestamptz'))).toEqual(['now()']);
    expect(sql(type('timestamp'))).toEqual(['now()']);
    expect(sql(type('date'))).toEqual(['CURRENT_DATE']);
    expect(sql(type('jsonb'))).toEqual(["'{}'", "'[]'"]);
  });

  test('an array can start empty, whatever it is an array of', () => {
    expect(sql(type('integer', { isArray: true }))).toEqual(["'{}'"]);
  });

  test("an enum's presets are its labels, quoted", () => {
    expect(
      sql(type('mood', { schema: 'public' }), ['happy', "it's fine"]),
    ).toEqual(["'happy'", "'it''s fine'"]);
  });

  test('a type with no sensible default has none', () => {
    expect(sql(type('inet'))).toEqual([]);
    expect(sql(type('mood', { schema: 'public' }))).toEqual([]);
  });

  test('every preset has an id of its own within the type', () => {
    const ids = presetsFor(type('boolean')).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('constantExpression', () => {
  test('keeps a number or a boolean as typed, and quotes anything else', () => {
    expect(constantExpression(type('integer'), ' 42 ')).toBe('42');
    expect(constantExpression(type('boolean'), 'true')).toBe('true');
    expect(constantExpression(type('text'), "it's")).toBe("'it''s'");
    expect(constantExpression(type('date'), '2020-01-01')).toBe("'2020-01-01'");
    expect(
      constantExpression(type('integer', { isArray: true }), '{1,2}'),
    ).toBe("'{1,2}'");
  });
});
