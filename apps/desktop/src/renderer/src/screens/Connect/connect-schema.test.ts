import { describe, expect, test } from 'vitest';
import {
  connectSchema,
  defaultSslMode,
  effectiveSslMode,
  initialValues,
  takeSslMode,
  type ConnectValues,
} from './connect-schema';

const values = (over: Partial<ConnectValues> = {}): ConnectValues =>
  ({ ...initialValues, database: 'app', ...over }) as ConnectValues;

/** The result as the form sees it: the first message of each field, or the parameters. */
function run(v: ConnectValues) {
  const result = connectSchema.safeParse(v);
  if (result.success) return { ok: true as const, ...result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues)
    errors[String(issue.path[0])] ??= issue.message;
  return { ok: false as const, errors };
}
const errorsOf = (v: ConnectValues) => {
  const r = run(v);
  if (r.ok) throw new Error('valid');
  return r.errors;
};

describe('the SSL default follows the host until a mode is picked', () => {
  test.each([
    ['localhost', 'disable'],
    ['127.0.0.1', 'disable'],
    ['::1', 'disable'],
    ['db.example.com', 'require'],
    ['10.0.0.5', 'require'],
  ])('%s gives %s', (host, mode) => {
    expect(defaultSslMode(values({ host }))).toBe(mode);
    expect(effectiveSslMode(values({ host }))).toBe(mode);
  });

  test('a socket is disable, and so is a connection string for this machine', () => {
    expect(
      defaultSslMode(values({ mode: 'socket', host: '/var/run/postgresql' })),
    ).toBe('disable');
    expect(
      defaultSslMode(
        values({ mode: 'url', url: 'postgres://u@localhost/app' }),
      ),
    ).toBe('disable');
    expect(
      defaultSslMode(
        values({ mode: 'url', url: 'postgres://u@db.example.com/app' }),
      ),
    ).toBe('require');
  });

  test('a mode that was picked stays when the host changes', () => {
    expect(
      effectiveSslMode(values({ host: 'db.example.com', sslMode: 'prefer' })),
    ).toBe('prefer');
  });
});

describe('the fields mode', () => {
  test('gives connection parameters, with the port as a number and the SSL default', () => {
    expect(run(values({ password: 'pw' }))).toEqual({
      ok: true,
      remember: false,
      params: {
        kind: 'params',
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'pw',
        database: 'app',
        sslMode: 'disable',
      },
    });
    expect(run(values({ host: ' db.example.com ' }))).toMatchObject({
      ok: true,
      params: { host: 'db.example.com', sslMode: 'require' },
    });
  });

  test('an empty password is no password, and remember is passed on', () => {
    const r = run(values({ remember: true }));
    expect(r).toMatchObject({ ok: true, remember: true });
    expect(r).not.toHaveProperty('params.password');
  });

  test('each missing or bad field has its own message, all at once', () => {
    expect(
      errorsOf(values({ host: ' ', user: '', database: '', port: '' })),
    ).toEqual({
      host: 'Enter a host',
      user: 'Enter a user',
      database: 'Enter a database name',
      port: 'Enter a port between 1 and 65535',
    });
    for (const port of ['0', '65536', '5432.5', 'abc', '-1'])
      expect(errorsOf(values({ port })).port, port).toBe(
        'Enter a port between 1 and 65535',
      );
  });

  test('verify-full asks for the CA file, along with any other mistake', () => {
    expect(errorsOf(values({ sslMode: 'verify-full' }))).toEqual({
      sslCaPath: 'Choose the CA certificate file',
    });
    expect(errorsOf(values({ sslMode: 'verify-full', host: '' }))).toEqual({
      host: 'Enter a host',
      sslCaPath: 'Choose the CA certificate file',
    });
    expect(
      run(values({ sslMode: 'verify-full', sslCaPath: ' /etc/ca.pem ' })),
    ).toMatchObject({
      ok: true,
      params: { sslMode: 'verify-full', sslCaPath: '/etc/ca.pem' },
    });
  });

  test('a remote host with the default needs no CA file, since the default is require', () => {
    expect(run(values({ host: 'db.example.com' }))).toMatchObject({
      ok: true,
      params: { sslMode: 'require' },
    });
  });

  test('what only another mode uses is not checked', () => {
    expect(run(values({ url: 'not a url', mode: 'fields' })).ok).toBe(true);
  });
});

describe('the socket mode', () => {
  const socket = (over: Partial<ConnectValues> = {}) =>
    values({
      mode: 'socket',
      host: '/var/run/postgresql',
      user: 'tester',
      ...over,
    });

  test('gives a socket connection, and never a password', () => {
    expect(run(socket({ password: 'ignored' }))).toEqual({
      ok: true,
      remember: false,
      params: {
        kind: 'socket',
        host: '/var/run/postgresql',
        port: 5432,
        user: 'tester',
        database: 'app',
        sslMode: 'disable',
      },
    });
  });

  test('wants a directory', () => {
    expect(errorsOf(socket({ host: 'localhost' })).host).toBe(
      'The socket directory is a path starting with /',
    );
    expect(errorsOf(socket({ host: '' })).host).toBe(
      'Enter the socket directory',
    );
  });
});

describe('the connection string mode', () => {
  const url = (text: string) =>
    values({ mode: 'url', url: text, database: '' });

  test('gives its database from the path, and keeps the password in the string', () => {
    expect(run(url(' postgres://u:pw@h:5432/my%20db '))).toEqual({
      ok: true,
      remember: false,
      params: {
        kind: 'url',
        url: 'postgres://u:pw@h:5432/my%20db',
        database: 'my db',
        sslMode: 'require',
      },
    });
  });

  test('says what is missing', () => {
    expect(errorsOf(url('')).url).toBe('Enter a connection string');
    expect(errorsOf(url('mysql://h/db')).url).toBe(
      'A connection string starts with postgres:// or postgresql://',
    );
    expect(errorsOf(url('postgres://u@h')).url).toBe(
      'Add the database to the connection string (…/database)',
    );
  });

  test('the host fields are not checked', () => {
    expect(
      run({ ...url('postgres://u@localhost/app'), host: '', port: 'x' }).ok,
    ).toBe(true);
  });
});

describe('takeSslMode', () => {
  test.each([
    ['disable', 'disable'],
    ['allow', 'prefer'],
    ['prefer', 'prefer'],
    ['require', 'require'],
    ['verify-ca', 'verify-full'],
    ['verify-full', 'verify-full'],
  ])('sslmode=%s gives %s and leaves the rest of the text', (sslmode, mode) => {
    expect(
      takeSslMode(`postgres://u@h/app?sslmode=${sslmode}&application_name=x`),
    ).toEqual({
      text: 'postgres://u@h/app?application_name=x',
      sslMode: mode,
    });
  });

  test('an unknown sslmode is taken out and gives no mode', () => {
    expect(takeSslMode('postgres://u@h/app?sslmode=weird')).toEqual({
      text: 'postgres://u@h/app',
      sslMode: null,
    });
  });

  test('text without sslmode, or that is not a connection string, is left alone', () => {
    expect(takeSslMode('postgres://u@h/app')).toBeNull();
    expect(takeSslMode('not a url yet')).toBeNull();
    expect(takeSslMode('')).toBeNull();
  });
});
