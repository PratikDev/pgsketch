import { expect, test } from 'vitest';
import { migrationFileName } from './file-name';

test('the name is the local date and time, padded, then pgsketch.sql', () => {
  expect(migrationFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
    '20260102_030405_pgsketch.sql',
  );
  expect(migrationFileName(new Date(2026, 11, 31, 23, 59, 59))).toBe(
    '20261231_235959_pgsketch.sql',
  );
});
