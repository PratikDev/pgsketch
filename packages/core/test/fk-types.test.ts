import { expect, test } from 'vitest';
import { fkTypesCompatible } from '../src/model/fk-types';
import type { PgType } from '../src/model/types';

const t = (name: string, over: Partial<PgType> = {}): PgType => ({
  name,
  isArray: false,
  ...over,
});

test.each([
  [t('integer'), t('integer', { params: [4] }), true],
  [t('integer'), t('bigint'), true],
  [t('integer'), t('numeric'), true],
  [t('numeric'), t('integer'), false],
  [t('real'), t('numeric'), false],
  [t('real'), t('double precision'), true],
  [t('text'), t('varchar', { params: [10] }), true],
  [t('bpchar'), t('text'), true],
  [t('date'), t('timestamptz'), true],
  [t('time'), t('timetz'), true],
  [t('timetz'), t('time'), false],
  [t('uuid'), t('text'), false],
  [t('integer', { isArray: true }), t('bigint', { isArray: true }), false],
  [t('integer', { isArray: true }), t('integer', { isArray: true }), true],
  [t('mood', { schema: 'public' }), t('mood', { schema: 'public' }), true],
  [t('mood', { schema: 'public' }), t('other', { schema: 'public' }), false],
  [t('mood', { schema: 'public' }), t('text'), false],
])('%j references %j: %s', (fkType, keyType, expected) => {
  expect(fkTypesCompatible(fkType, keyType)).toBe(expected);
});
