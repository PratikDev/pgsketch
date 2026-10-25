import { describe, expect, test } from 'vitest';
import type { PgType } from '../src/model/types';
import {
  classifyTypeChange,
  type TypeChangeRisk,
} from '../src/risk/type-changes';
import { renderPgType } from '../src/sql/pgtype';

const t = (name: string, params?: number[], isArray = false): PgType => ({
  name,
  ...(params && { params }),
  isArray,
});

describe('known-safe widenings', () => {
  test.each<[string, PgType, PgType]>([
    ['smallint to integer', t('smallint'), t('integer')],
    ['smallint to bigint', t('smallint'), t('bigint')],
    ['integer to bigint', t('integer'), t('bigint')],
    ['varchar(10) to varchar(20)', t('varchar', [10]), t('varchar', [20])],
    ['varchar(10) to varchar with no length', t('varchar', [10]), t('varchar')],
    ['varchar(10) to text', t('varchar', [10]), t('text')],
    ['varchar with no length to text', t('varchar'), t('text')],
    ['text to varchar with no length', t('text'), t('varchar')],
    [
      'numeric(10,2) to numeric(12,2): more digits, same scale',
      t('numeric', [10, 2]),
      t('numeric', [12, 2]),
    ],
    [
      'numeric(10) to numeric(12): scale 0 both',
      t('numeric', [10]),
      t('numeric', [12]),
    ],
  ])('%s', (_label, from, to) => {
    expect(classifyTypeChange(from, to)).toBe('safe');
  });

  test('a column changed to exactly the same type is safe', () => {
    expect(classifyTypeChange(t('integer'), t('integer'))).toBe('safe');
    expect(
      classifyTypeChange(t('numeric', [10, 2]), t('numeric', [10, 2])),
    ).toBe('safe');
    expect(
      classifyTypeChange(
        t('integer', undefined, true),
        t('integer', undefined, true),
      ),
    ).toBe('safe');
  });
});

describe('known-lossy conversions', () => {
  test.each<[string, PgType, PgType]>([
    [
      'numeric scale decrease: numeric(10,2) to numeric(10,1)',
      t('numeric', [10, 2]),
      t('numeric', [10, 1]),
    ],
    [
      'numeric(10,2) to numeric(12,0), more digits but no scale',
      t('numeric', [10, 2]),
      t('numeric', [12]),
    ],
    ['real to integer', t('real'), t('integer')],
    ['double precision to bigint', t('double precision'), t('bigint')],
    ['double precision to smallint', t('double precision'), t('smallint')],
    ['timestamp to date', t('timestamp'), t('date')],
    ['timestamptz to date', t('timestamptz'), t('date')],
    ['text to varchar(10)', t('text'), t('varchar', [10])],
  ])('%s', (_label, from, to) => {
    expect(classifyTypeChange(from, to)).toBe('lossy');
  });
});

describe('anything unlisted may fail, never safe', () => {
  test.each<[string, PgType, PgType]>([
    [
      'bigint to integer: narrowing errors on large values',
      t('bigint'),
      t('integer'),
    ],
    ['integer to smallint', t('integer'), t('smallint')],
    ['integer to real', t('integer'), t('real')],
    ['real to double precision', t('real'), t('double precision')],
    [
      'varchar(20) to varchar(10): shrinking',
      t('varchar', [20]),
      t('varchar', [10]),
    ],
    ['varchar with no length to varchar(10)', t('varchar'), t('varchar', [10])],
    [
      'numeric(10,2) to numeric(8,2): fewer digits',
      t('numeric', [10, 2]),
      t('numeric', [8, 2]),
    ],
    [
      'numeric(10,2) to numeric(12,3): a bigger scale is not listed',
      t('numeric', [10, 2]),
      t('numeric', [12, 3]),
    ],
    [
      'numeric(10,2) to numeric with no precision',
      t('numeric', [10, 2]),
      t('numeric'),
    ],
    [
      'numeric with no precision to numeric(10,2)',
      t('numeric'),
      t('numeric', [10, 2]),
    ],
    ['date to timestamp', t('date'), t('timestamp')],
    [
      'timestamp to timestamptz: depends on the time zone',
      t('timestamp'),
      t('timestamptz'),
    ],
    ['uuid to text', t('uuid'), t('text')],
    ['text to integer', t('text'), t('integer')],
    ['integer to boolean', t('integer'), t('boolean')],
    ['an enum to text', t('mood', undefined), t('text')],
  ])('%s', (_label, from, to) => {
    expect(classifyTypeChange(from, to)).toBe('may-fail');
  });

  test('arrays are not classified: an array of a widening is still may-fail', () => {
    expect(
      classifyTypeChange(
        t('integer', undefined, true),
        t('bigint', undefined, true),
      ),
    ).toBe('may-fail');
    expect(
      classifyTypeChange(t('integer'), t('integer', undefined, true)),
    ).toBe('may-fail');
    expect(
      classifyTypeChange(t('integer', undefined, true), t('integer')),
    ).toBe('may-fail');
  });

  test('user-defined types are not classified, even when the names match a built-in', () => {
    const user = (name: string): PgType => ({
      name,
      schema: 'app',
      isArray: false,
    });
    expect(classifyTypeChange(user('integer'), user('bigint'))).toBe(
      'may-fail',
    );
    expect(classifyTypeChange(user('varchar'), t('text'))).toBe('may-fail');
    expect(classifyTypeChange(t('smallint'), user('integer'))).toBe('may-fail');
  });
});

describe('the whole matrix', () => {
  const types: PgType[] = [
    t('smallint'),
    t('integer'),
    t('bigint'),
    t('numeric', [10, 2]),
    t('numeric', [12, 2]),
    t('numeric', [10, 1]),
    t('numeric', [12, 3]),
    t('numeric'),
    t('real'),
    t('double precision'),
    t('varchar'),
    t('varchar', [10]),
    t('varchar', [20]),
    t('text'),
    t('date'),
    t('timestamp'),
    t('timestamptz'),
    t('uuid'),
    t('integer', undefined, true),
    { name: 'mood', schema: 'public', isArray: false },
  ];
  const safe = [
    'smallint -> integer',
    'smallint -> bigint',
    'integer -> bigint',
    'varchar(10) -> varchar(20)',
    'varchar(10) -> varchar',
    'varchar(20) -> varchar',
    'varchar -> text',
    'varchar(10) -> text',
    'varchar(20) -> text',
    'text -> varchar',
    'numeric(10,2) -> numeric(12,2)',
  ];
  const lossy = [
    'numeric(10,2) -> numeric(10,1)',
    'numeric(12,2) -> numeric(10,1)',
    'numeric(12,3) -> numeric(10,2)',
    'numeric(12,3) -> numeric(12,2)',
    'numeric(12,3) -> numeric(10,1)',
    'real -> smallint',
    'real -> integer',
    'real -> bigint',
    'double precision -> smallint',
    'double precision -> integer',
    'double precision -> bigint',
    'timestamp -> date',
    'timestamptz -> date',
    'text -> varchar(10)',
    'text -> varchar(20)',
  ];

  test('exactly the listed pairs are safe or lossy and every other pair may fail', () => {
    const found: Record<TypeChangeRisk, string[]> = {
      safe: [],
      lossy: [],
      'may-fail': [],
    };
    for (const from of types) {
      for (const to of types) {
        const pair = `${renderPgType(from)} -> ${renderPgType(to)}`;
        if (renderPgType(from) === renderPgType(to)) continue; // the same type is covered above
        found[classifyTypeChange(from, to)].push(pair);
      }
    }
    expect(found.safe.sort()).toEqual([...safe].sort());
    expect(found.lossy.sort()).toEqual([...lossy].sort());
    expect(found['may-fail']).toHaveLength(
      types.length * (types.length - 1) - safe.length - lossy.length,
    );
  });
});
