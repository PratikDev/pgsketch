import { expect, test } from 'vitest';
import { coreName } from '../src/index';

test('core package is wired up', () => {
  expect(coreName).toBe('@pgsketch/core');
});
