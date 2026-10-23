import { describe, expect, test } from 'vitest';
import { buildCastData } from '../src/introspect/casts';
import { needsUsing, typeKey, type CastData } from '../src/sql/coercion';
import type { PgType } from '../src/model/types';

const t = (name: string, over: Partial<PgType> = {}): PgType => ({
  name,
  isArray: false,
  ...over,
});

const data: CastData = {
  categories: {
    integer: 'N',
    bigint: 'N',
    numeric: 'N',
    text: 'S',
    varchar: 'S',
    boolean: 'B',
    'public.mood': 'E',
    'public.posint': 'N',
    'public.small': 'N',
  },
  domains: { 'public.posint': 'integer', 'public.small': 'public.posint' },
  casts: {
    'integer>bigint': 'i',
    'bigint>integer': 'a',
    'integer>boolean': 'e',
    'integer>numeric': 'i',
  },
};

describe('needsUsing', () => {
  test('the same type with another length or precision needs none', () => {
    expect(
      needsUsing(
        t('varchar', { params: [50] }),
        t('varchar', { params: [20] }),
        data,
      ),
    ).toBe(false);
    expect(
      needsUsing(
        t('numeric', { params: [10, 2] }),
        t('numeric', { params: [5, 1] }),
        data,
      ),
    ).toBe(false);
  });

  test('any type to a string type needs none; a string to anything else does', () => {
    expect(needsUsing(t('integer'), t('text'), data)).toBe(false);
    expect(
      needsUsing(t('mood', { schema: 'public' }), t('varchar'), data),
    ).toBe(false);
    expect(needsUsing(t('text'), t('varchar'), data)).toBe(false);
    expect(needsUsing(t('text'), t('integer'), data)).toBe(true);
    expect(needsUsing(t('text'), t('mood', { schema: 'public' }), data)).toBe(
      true,
    );
  });

  test('implicit and assignment casts need none; explicit-only and missing casts do', () => {
    expect(needsUsing(t('integer'), t('bigint'), data)).toBe(false);
    expect(needsUsing(t('bigint'), t('integer'), data)).toBe(false);
    expect(needsUsing(t('integer'), t('boolean'), data)).toBe(true);
    expect(needsUsing(t('boolean'), t('integer'), data)).toBe(true);
    expect(
      needsUsing(t('mood', { schema: 'public' }), t('integer'), data),
    ).toBe(true);
  });

  test('arrays follow their element types, and an array never converts to a non-array', () => {
    expect(
      needsUsing(
        t('integer', { isArray: true }),
        t('bigint', { isArray: true }),
        data,
      ),
    ).toBe(false);
    expect(
      needsUsing(
        t('integer', { isArray: true }),
        t('boolean', { isArray: true }),
        data,
      ),
    ).toBe(true);
    expect(
      needsUsing(
        t('integer', { isArray: true }),
        t('text', { isArray: true }),
        data,
      ),
    ).toBe(false);
    expect(
      needsUsing(t('integer', { isArray: true }), t('integer'), data),
    ).toBe(true);
    expect(
      needsUsing(t('integer'), t('integer', { isArray: true }), data),
    ).toBe(true);
  });

  test('domains follow their base type, including a domain over a domain', () => {
    expect(
      needsUsing(t('posint', { schema: 'public' }), t('integer'), data),
    ).toBe(false);
    expect(
      needsUsing(t('integer'), t('posint', { schema: 'public' }), data),
    ).toBe(false);
    expect(
      needsUsing(t('small', { schema: 'public' }), t('bigint'), data),
    ).toBe(false);
    expect(
      needsUsing(t('small', { schema: 'public' }), t('boolean'), data),
    ).toBe(true);
  });

  test('a type missing from the data needs USING unless it goes to a string', () => {
    expect(needsUsing(t('mystery'), t('integer'), data)).toBe(true);
    expect(needsUsing(t('mystery'), t('mystery'), data)).toBe(false);
  });
});

test('typeKey qualifies user types only', () => {
  expect(typeKey(t('integer'))).toBe('integer');
  expect(typeKey(t('mood', { schema: 'public' }))).toBe('public.mood');
});

test('buildCastData keys everything by model type names and skips what it cannot represent', () => {
  const built = buildCastData(
    [
      { oid: 23, name: 'integer', category: 'N', base_oid: 0 },
      { oid: 20, name: 'bigint', category: 'N', base_oid: 0 },
      { oid: 1043, name: 'character varying', category: 'S', base_oid: 0 },
      { oid: 900, name: 'public.posint', category: 'N', base_oid: 23 },
      {
        oid: 901,
        name: 'public.geometry(Point,4326)',
        category: 'U',
        base_oid: 0,
      },
    ],
    [
      { source: 23, target: 20, context: 'i' },
      { source: 23, target: 901, context: 'e' },
    ],
  );
  expect(built).toEqual({
    categories: {
      integer: 'N',
      bigint: 'N',
      varchar: 'S',
      'public.posint': 'N',
    },
    domains: { 'public.posint': 'integer' },
    casts: { 'integer>bigint': 'i' },
  });
});
