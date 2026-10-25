import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createLogger,
  defaultLogPath,
  fileSink,
  redact,
  type LogValue,
} from './log';

describe('redact', () => {
  test.each([
    [
      'postgres://alice:s3cr3t@db.example.com:5432/app?sslmode=require',
      'postgres://alice:***@db.example.com:5432/app?sslmode=require',
    ],
    ['postgresql://alice:p%40ss%2Fword@h/db', 'postgresql://alice:***@h/db'],
    ['postgres://alice:p@ss:word@h:5432/db', 'postgres://alice:***@h:5432/db'],
    ['postgres://:onlypass@h/db', 'postgres://:***@h/db'],
    ['postgres://alice:@h/db', 'postgres://alice:***@h/db'],
    [
      'postgres://h/db?user=a&password=abc&sslmode=disable',
      'postgres://h/db?user=a&password=***&sslmode=disable',
    ],
    [
      "host=h user=u password='a b c' dbname=d",
      'host=h user=u password=*** dbname=d',
    ],
    ['host=h password=abc dbname=d', 'host=h password=*** dbname=d'],
    ['sslpassword=k&x=1', 'sslpassword=***&x=1'],
    ['PGPASSWORD=zzz psql -h h', 'PGPASSWORD=*** psql -h h'],
    ['password = abc', 'password=***'],
  ])('%s', (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  test('several in one string, and in an error message from the driver', () => {
    expect(
      redact('tried postgres://a:one@h1/db then postgres://b:two@h2/db'),
    ).toBe('tried postgres://a:***@h1/db then postgres://b:***@h2/db');
  });

  test.each([
    'postgres://alice@db.example.com:5432/app',
    'postgres://localhost/app',
    'contact bob@example.com about https://example.com/a:b',
    'password authentication failed for user "alice"',
    'no secrets here',
    '',
  ])('leaves %j alone', (input) => {
    expect(redact(input)).toBe(input);
  });
});

const lines = () => {
  const out: string[] = [];
  const logger = createLogger({
    write: (line) => out.push(line),
    now: () => new Date('2026-01-02T03:04:05.678Z'),
  });
  return { out, logger };
};

describe('the logger', () => {
  test('a logged URL has its password removed', () => {
    const { out, logger } = lines();
    logger.info('connecting to postgres://alice:hunter2@db:5432/app');
    expect(out).toEqual([
      '2026-01-02T03:04:05.678Z INFO connecting to postgres://alice:***@db:5432/app',
    ]);
    expect(out.join()).not.toContain('hunter2');
  });

  test('every level, with context as JSON', () => {
    const { out, logger } = lines();
    logger.debug('d');
    logger.warn('w', { n: 1, ok: true, none: null, list: ['a', 2] });
    logger.error('e', { nested: { deeper: 'x' } });
    expect(out).toEqual([
      '2026-01-02T03:04:05.678Z DEBUG d',
      '2026-01-02T03:04:05.678Z WARN w {"n":1,"ok":true,"none":null,"list":["a",2]}',
      '2026-01-02T03:04:05.678Z ERROR e {"nested":{"deeper":"x"}}',
    ]);
  });

  test('strings in the context are redacted, and so is any key that looks like a secret', () => {
    const { out, logger } = lines();
    logger.info('open', {
      url: 'postgres://u:pw1@h/db',
      password: 'pw2',
      nested: {
        dbPassword: 'pw3',
        apiToken: 'pw4',
        client_secret: 'pw5',
        plain: 'ok',
      },
      list: ['host=h password=pw6'],
      empty: null,
    });
    const line = out[0]!;
    for (const pw of ['pw1', 'pw2', 'pw3', 'pw4', 'pw5', 'pw6'])
      expect(line, pw).not.toContain(pw);
    expect(line).toContain('"plain":"ok"');
    expect(line).toContain('"empty":null');
  });

  test('an error is logged with its name, message and stack, all redacted, and its cause', () => {
    const { out, logger } = lines();
    const error = new Error('connect failed for postgres://u:secret1@h/db', {
      cause: new Error('inner password=secret2'),
    });
    logger.error('failed', { error });
    const line = out[0]!;
    expect(line).not.toContain('secret1');
    expect(line).not.toContain('secret2');
    expect(line).toContain('connect failed for postgres://u:***@h/db');
    expect(line).toContain('inner password=***');
    expect(line).toContain('"stack":');
  });

  test('an entry is one line, whatever the text holds', () => {
    const { out, logger } = lines();
    logger.info('first\n2026-01-01T00:00:00.000Z ERROR forged\r\nmore', {
      text: 'a\nb',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).not.toMatch(/[\r\n]/);
    expect(out[0]).toContain('first\\n2026');
  });

  test('a cycle in the context does not throw', () => {
    const { out, logger } = lines();
    const loop: { [key: string]: LogValue } = { name: 'loop' };
    loop.self = loop;
    logger.info('cycle', { loop });
    expect(out[0]).toContain('[Circular]');
  });

  test('the same message and time always give the same line', () => {
    const a = lines();
    const b = lines();
    a.logger.info('same', { x: 1 });
    b.logger.info('same', { x: 1 });
    expect(a.out).toEqual(b.out);
  });
});

describe('where the log goes', () => {
  test('the path follows XDG_STATE_HOME when it is absolute, else the home folder', () => {
    expect(defaultLogPath({}, '/home/me')).toBe(
      '/home/me/.local/state/pgsketch/main.log',
    );
    expect(defaultLogPath({ XDG_STATE_HOME: '/state' }, '/home/me')).toBe(
      '/state/pgsketch/main.log',
    );
    expect(defaultLogPath({ XDG_STATE_HOME: 'relative' }, '/home/me')).toBe(
      '/home/me/.local/state/pgsketch/main.log',
    );
    expect(defaultLogPath({ XDG_STATE_HOME: '' }, '/home/me')).toBe(
      '/home/me/.local/state/pgsketch/main.log',
    );
  });

  test('lines are appended to a file only its owner can read, in a folder made on the first write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pgsketch-log-'));
    const path = join(dir, 'nested', 'main.log');
    const write = fileSink(path);
    const logger = createLogger({ write, now: () => new Date(0) });
    logger.info('one');
    logger.info('postgres://u:pw@h/d');
    const text = readFileSync(path, 'utf8');
    expect(text).toBe(
      '1970-01-01T00:00:00.000Z INFO one\n1970-01-01T00:00:00.000Z INFO postgres://u:***@h/d\n',
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
