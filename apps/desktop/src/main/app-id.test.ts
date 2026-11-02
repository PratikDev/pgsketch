import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { APP_ID } from '../shared/app-id';

test('the app id is the appId the installers are built with', () => {
  const builder = readFileSync(
    new URL('../../electron-builder.yml', import.meta.url),
    'utf8',
  );
  expect(/^appId:\s*(\S+)\s*$/m.exec(builder)?.[1]).toBe(APP_ID);
});
