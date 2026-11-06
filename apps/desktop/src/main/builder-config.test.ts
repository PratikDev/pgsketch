import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const root = new URL('../../', import.meta.url);

// electron-builder uses no icon it is not told of, and then puts Electron's own on the program
// without a word; the first Windows installer had it
test.each(['linux', 'win'])(
  'the %s build is told which icon to use, and it exists',
  (platform) => {
    const config = readFileSync(new URL('electron-builder.yml', root), 'utf8');
    const section = new RegExp(
      `^${platform}:\\n((?:[ \\t].*\\n|\\n)*)`,
      'm',
    ).exec(config);
    const icon = /^[ \t]+icon:\s*(\S+)\s*$/m.exec(section?.[1] ?? '')?.[1];
    expect(icon, `no icon in the ${platform} section`).toBeDefined();
    expect(existsSync(new URL(icon ?? '', root))).toBe(true);
  },
);
