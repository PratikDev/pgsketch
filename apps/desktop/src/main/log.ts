import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** What can go into a log line's context: plain data, and errors. */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Error
  | LogValue[]
  | { [key: string]: LogValue };

export interface Logger {
  debug: (message: string, context?: Record<string, LogValue>) => void;
  info: (message: string, context?: Record<string, LogValue>) => void;
  warn: (message: string, context?: Record<string, LogValue>) => void;
  error: (message: string, context?: Record<string, LogValue>) => void;
}

const MASK = '***';

// `scheme://user:password@host`: the password runs up to the last `@` before the path, since
// that is where a URL parser ends the user info
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s/]*@/gi;
// `password=…`, `sslpassword=…` and `PGPASSWORD=…`, in a query string, a libpq string or an environment
const PASSWORD_PARAM =
  /([a-z0-9_]*password)\s*=\s*('(?:[^'\\]|\\.)*'|[^&\s]*)/gi;
const SECRET_KEY = /pass|secret|token|credential|private/i;

/** The text with every password in it replaced, wherever a connection string or setting puts one. */
export function redact(text: string): string {
  return text
    .replace(URL_PASSWORD, `$1:${MASK}@`)
    .replace(PASSWORD_PARAM, `$1=${MASK}`);
}

function plain(value: LogValue, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redact(value.message),
      stack: value.stack === undefined ? undefined : redact(value.stack),
      cause:
        value.cause instanceof Error
          ? plain(value.cause, seen)
          : value.cause === undefined
            ? undefined
            : redact(String(value.cause)),
    };
  }
  if (Array.isArray(value)) return value.map((v) => plain(v, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      SECRET_KEY.test(key) && v !== undefined && v !== null
        ? MASK
        : plain(v, seen),
    ]),
  );
}

const oneLine = (text: string) => text.replace(/\r?\n|\r/g, '\\n');

export interface LoggerOptions {
  /** Gets each finished line, without the newline. */
  write: (line: string) => void;
  /** For tests; defaults to the clock. */
  now?: () => Date;
}

/**
 * A logger whose lines never hold a password: the message and every string in the context are
 * redacted, and so is the value of any key that looks like a secret. A line is one line whatever
 * the message holds, so text from outside can't pass itself off as another entry.
 */
export function createLogger({
  write,
  now = () => new Date(),
}: LoggerOptions): Logger {
  const at =
    (level: LogLevel) =>
    (message: string, context?: Record<string, LogValue>): void => {
      const tail =
        context === undefined
          ? ''
          : ` ${JSON.stringify(plain(context, new WeakSet()))}`;
      write(
        oneLine(
          `${now().toISOString()} ${level.toUpperCase()} ${redact(message)}${tail}`,
        ),
      );
    };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  };
}

/** `~/.local/state/pgsketch/main.log`, or under `XDG_STATE_HOME` when that is set to a path. */
export function defaultLogPath(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  const stateHome =
    env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME
      : join(home, '.local', 'state');
  return join(stateHome, 'pgsketch', 'main.log');
}

/**
 * Appends lines to a file that only its owner can read, creating the folder on the first line.
 * shortcut: synchronous writes and no rotation, fine for the few lines a session writes; rotate
 * the file if the log ever gets chatty.
 */
export function fileSink(path: string): (line: string) => void {
  let ready = false;
  return (line) => {
    if (!ready) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      ready = true;
    }
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
  };
}
