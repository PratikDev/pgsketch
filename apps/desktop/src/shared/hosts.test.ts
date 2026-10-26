import { expect, test } from 'vitest';
import { isLocalHost } from './hosts';

test.each([
  ['localhost', true],
  ['LocalHost', true],
  ['127.0.0.1', true],
  ['::1', true],
  ['[::1]', true],
  ['/var/run/postgresql', true],
  ['db.example.com', false],
  ['10.0.0.5', false],
  ['', false],
])('%j is local: %s', (host, local) => {
  expect(isLocalHost(host)).toBe(local);
});
