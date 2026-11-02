import { expect, test } from 'vitest';
import { NAME, psqlArgs, readyCount, runArgs } from './dev-db';

test('the container is named, published on the chosen port and given the password', () => {
  expect(runArgs('15', '5433')).toEqual([
    ...['run', '-d', '--rm', '--name', NAME],
    ...['-e', 'POSTGRES_PASSWORD=test', '-p', '5433:5432'],
    'postgres:15',
  ]);
});

test('the server is ready at the second "ready to accept connections", not the first', () => {
  const first = 'LOG: database system is ready to accept connections\n';
  expect(readyCount('')).toBe(0);
  expect(readyCount(first)).toBe(1);
  expect(readyCount(`${first}LOG: shutting down\n${first}`)).toBe(2);
});

test('psql runs in the container, as postgres, and stops at the first error', () => {
  expect(psqlArgs('-q', '-d', 'pgsketch')).toEqual([
    ...['exec', '-i', NAME, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    ...['-q', '-d', 'pgsketch'],
  ]);
});
