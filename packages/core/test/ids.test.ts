import { expect, test } from 'vitest';
import {
  columnId,
  constraintId,
  enumId,
  indexId,
  newId,
  schemaId,
  tableId,
  unmodeledId,
} from '../src/model/ids';

test('the same OIDs give the same IDs', () => {
  expect(tableId(16384)).toBe(tableId(16384));
  expect(columnId(16384, 2)).toBe(columnId('16384', 2));
  expect(tableId(1)).not.toBe(tableId(2));
});

test('IDs follow the documented formats', () => {
  expect(schemaId(2200)).toBe('s:2200');
  expect(tableId(16384)).toBe('t:16384');
  expect(columnId(16384, 3)).toBe('c:16384:3');
  expect(constraintId(5)).toBe('k:5');
  expect(indexId(6)).toBe('i:6');
  expect(enumId(7)).toBe('e:7');
  expect(unmodeledId('view', 8)).toBe('u:view:8');
});

test('IDs from different catalogs with the same OID never collide', () => {
  expect(unmodeledId('trigger', 9)).not.toBe(unmodeledId('function', 9));
  expect(tableId(9)).not.toBe(indexId(9));
});

test('new IDs are unique and never look OID-based', () => {
  const ids = new Set(Array.from({ length: 1000 }, newId));
  expect(ids.size).toBe(1000);
  for (const id of ids) expect(id).not.toContain(':');
});
