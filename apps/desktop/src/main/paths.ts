import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { defaultLogPath } from './log';

export interface AppPaths {
  /** Everything the app keeps: its database, and Electron's own user data. */
  dataDir: string;
  dbFile: string;
  logFile: string;
}

const absolute = (value: string | undefined): string | undefined =>
  value && isAbsolute(value) ? value : undefined;

/**
 * Where the app keeps its files. `PGSKETCH_DATA_DIR` puts all of it in one folder (the logs too),
 * which is how each end-to-end test gets a folder of its own. Otherwise the data is under
 * `~/.local/share/pgsketch` and the log under `~/.local/state/pgsketch`, following `XDG_DATA_HOME`
 * and `XDG_STATE_HOME` when they are set to absolute paths.
 */
export function resolveAppPaths(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): AppPaths {
  const override = env.PGSKETCH_DATA_DIR;
  if (override) {
    const dataDir = resolve(override);
    return {
      dataDir,
      dbFile: join(dataDir, 'pgsketch.db'),
      logFile: join(dataDir, 'main.log'),
    };
  }
  const dataDir = join(
    absolute(env.XDG_DATA_HOME) ?? join(home, '.local', 'share'),
    'pgsketch',
  );
  return {
    dataDir,
    dbFile: join(dataDir, 'pgsketch.db'),
    logFile: defaultLogPath(env, home),
  };
}
