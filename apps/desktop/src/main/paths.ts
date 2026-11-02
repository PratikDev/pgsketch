import { homedir } from 'node:os';
import { defaultLogPath } from './log';
import { localAppData, pathsOf } from './platform-paths';

export interface AppPaths {
  /** Everything the app keeps: its database, and Electron's own user data. */
  dataDir: string;
  dbFile: string;
  logFile: string;
}

/**
 * Where the app keeps its files. `PGSKETCH_DATA_DIR` puts all of it in one folder (the logs too),
 * which is how each end-to-end test gets a folder of its own. Otherwise, on Linux the data is
 * under `~/.local/share/pgsketch` and the log under `~/.local/state/pgsketch`, following
 * `XDG_DATA_HOME` and `XDG_STATE_HOME` when they are set to absolute paths, and on Windows both
 * are under `%LOCALAPPDATA%\pgsketch`: this is one machine's data, so it must not roam.
 */
export function resolveAppPaths(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): AppPaths {
  const path = pathsOf(platform);
  const override = env.PGSKETCH_DATA_DIR;
  const dataDir = override
    ? path.resolve(override)
    : platform === 'win32'
      ? path.join(localAppData(env, home), 'pgsketch')
      : path.join(
          env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME)
            ? env.XDG_DATA_HOME
            : path.join(home, '.local', 'share'),
          'pgsketch',
        );
  return {
    dataDir,
    dbFile: path.join(dataDir, 'pgsketch.db'),
    logFile: override
      ? path.join(dataDir, 'main.log')
      : defaultLogPath(env, home, platform),
  };
}
