import { posix, win32 } from 'node:path';

/**
 * The path rules of a platform, whichever one this runs on, so the layout of each platform can be
 * tested on any machine. On the platform itself they are the same as `node:path`.
 */
export const pathsOf = (platform: NodeJS.Platform) =>
  platform === 'win32' ? win32 : posix;

/** `%LOCALAPPDATA%`, or where it is when the variable is missing or not an absolute path. */
export function localAppData(
  env: Record<string, string | undefined>,
  home: string,
): string {
  const set = env.LOCALAPPDATA;
  return set && win32.isAbsolute(set)
    ? set
    : win32.join(home, 'AppData', 'Local');
}
