import { describe, expect, test } from 'vitest';
import { resolveAppPaths } from './paths';

describe('resolveAppPaths', () => {
  test('by default the data and the log are where the plan says', () => {
    expect(resolveAppPaths({}, '/home/me')).toEqual({
      dataDir: '/home/me/.local/share/pgsketch',
      dbFile: '/home/me/.local/share/pgsketch/pgsketch.db',
      logFile: '/home/me/.local/state/pgsketch/main.log',
    });
  });

  test('the XDG folders are followed when they are absolute paths', () => {
    expect(
      resolveAppPaths(
        { XDG_DATA_HOME: '/data', XDG_STATE_HOME: '/state' },
        '/home/me',
      ),
    ).toEqual({
      dataDir: '/data/pgsketch',
      dbFile: '/data/pgsketch/pgsketch.db',
      logFile: '/state/pgsketch/main.log',
    });
    expect(
      resolveAppPaths({ XDG_DATA_HOME: 'relative' }, '/home/me').dataDir,
    ).toBe('/home/me/.local/share/pgsketch');
  });

  test('PGSKETCH_DATA_DIR puts everything in that folder, whatever the XDG settings say', () => {
    expect(
      resolveAppPaths(
        {
          PGSKETCH_DATA_DIR: '/tmp/test-1',
          XDG_DATA_HOME: '/data',
          XDG_STATE_HOME: '/state',
        },
        '/home/me',
      ),
    ).toEqual({
      dataDir: '/tmp/test-1',
      dbFile: '/tmp/test-1/pgsketch.db',
      logFile: '/tmp/test-1/main.log',
    });
  });

  test('an empty override is no override, and a relative one is made absolute', () => {
    expect(resolveAppPaths({ PGSKETCH_DATA_DIR: '' }, '/home/me').dataDir).toBe(
      '/home/me/.local/share/pgsketch',
    );
    expect(
      resolveAppPaths({ PGSKETCH_DATA_DIR: 'here' }, '/home/me').dataDir,
    ).toMatch(/^\/.*\/here$/);
  });
});

describe('resolveAppPaths on Windows', () => {
  const home = 'C:\\Users\\me';

  test('the data and the log are under %LOCALAPPDATA%, which does not roam', () => {
    expect(
      resolveAppPaths({ LOCALAPPDATA: 'D:\\Local' }, home, 'win32'),
    ).toEqual({
      dataDir: 'D:\\Local\\pgsketch',
      dbFile: 'D:\\Local\\pgsketch\\pgsketch.db',
      logFile: 'D:\\Local\\pgsketch\\logs\\main.log',
    });
  });

  test('a missing or relative LOCALAPPDATA falls back to the profile folder, and the XDG variables are ignored', () => {
    const fallback = 'C:\\Users\\me\\AppData\\Local\\pgsketch';
    expect(resolveAppPaths({}, home, 'win32').dataDir).toBe(fallback);
    expect(
      resolveAppPaths({ LOCALAPPDATA: 'relative' }, home, 'win32').dataDir,
    ).toBe(fallback);
    expect(
      resolveAppPaths({ XDG_DATA_HOME: '/data' }, home, 'win32').dataDir,
    ).toBe(fallback);
  });

  test('PGSKETCH_DATA_DIR still wins, with the log beside the database', () => {
    expect(
      resolveAppPaths(
        { PGSKETCH_DATA_DIR: 'E:\\test-1', LOCALAPPDATA: 'D:\\Local' },
        home,
        'win32',
      ),
    ).toEqual({
      dataDir: 'E:\\test-1',
      dbFile: 'E:\\test-1\\pgsketch.db',
      logFile: 'E:\\test-1\\main.log',
    });
  });
});
