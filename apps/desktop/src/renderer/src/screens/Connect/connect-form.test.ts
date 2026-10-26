import { describe, expect, test } from 'vitest';
import {
  defaultSslMode,
  effectiveSslMode,
  initialState,
  validate,
  withMode,
  withUrl,
  type FormState,
} from './connect-form';

const defaults = { osUser: 'tester', socketPath: '/var/run/postgresql' };
const state = (over: Partial<FormState> = {}): FormState => ({
  ...initialState,
  database: 'app',
  ...over,
});

describe('the SSL default follows the host until a mode is picked', () => {
  test.each([
    ['localhost', 'disable'],
    ['127.0.0.1', 'disable'],
    ['::1', 'disable'],
    ['db.example.com', 'require'],
    ['10.0.0.5', 'require'],
  ])('%s gives %s', (host, mode) => {
    expect(defaultSslMode(state({ host }))).toBe(mode);
    expect(effectiveSslMode(state({ host }))).toBe(mode);
  });

  test('a socket is disable, and so is the host of a connection string on this machine', () => {
    expect(
      defaultSslMode(state({ mode: 'socket', host: '/var/run/postgresql' })),
    ).toBe('disable');
    expect(
      defaultSslMode(state({ mode: 'url', url: 'postgres://u@localhost/app' })),
    ).toBe('disable');
    expect(
      defaultSslMode(
        state({ mode: 'url', url: 'postgres://u@db.example.com/app' }),
      ),
    ).toBe('require');
  });

  test('a mode the user picked is kept when the host changes', () => {
    expect(
      effectiveSslMode(state({ host: 'db.example.com', sslMode: 'prefer' })),
    ).toBe('prefer');
  });
});

describe('modes', () => {
  test('socket mode fills the operating system user and the socket directory, and clears the password', () => {
    const next = withMode(
      state({ user: 'postgres', password: 'secret' }),
      'socket',
      defaults,
    );
    expect(next).toMatchObject({
      mode: 'socket',
      host: '/var/run/postgresql',
      user: 'tester',
      password: '',
    });
  });

  test('going back to fields keeps what was typed, and a repeat of socket does not overwrite edits', () => {
    const socket = withMode(state(), 'socket', defaults);
    const edited = { ...socket, user: 'someone-else' };
    expect(withMode(edited, 'socket', defaults).user).toBe('someone-else');
    expect(withMode(edited, 'fields', defaults)).toMatchObject({
      mode: 'fields',
      user: 'someone-else',
    });
  });
});

describe('a pasted connection string', () => {
  test.each([
    ['disable', 'disable'],
    ['allow', 'prefer'],
    ['prefer', 'prefer'],
    ['require', 'require'],
    ['verify-ca', 'verify-full'],
    ['verify-full', 'verify-full'],
  ])(
    'sslmode=%s sets the selector to %s and leaves the text',
    (sslmode, mode) => {
      const next = withUrl(
        state({ mode: 'url' }),
        `postgres://u@h/app?sslmode=${sslmode}&application_name=x`,
      );
      expect(next.sslMode).toBe(mode);
      expect(next.url).toBe('postgres://u@h/app?application_name=x');
    },
  );

  test('without sslmode the text is kept as typed and the selector is not touched', () => {
    const next = withUrl(
      state({ mode: 'url', sslMode: 'require' }),
      'postgres://u@h/ap',
    );
    expect(next).toMatchObject({
      url: 'postgres://u@h/ap',
      sslMode: 'require',
    });
    expect(withUrl(state(), 'not a url yet').url).toBe('not a url yet');
  });

  test('an unknown sslmode is removed and leaves the selector as it was', () => {
    const next = withUrl(
      state({ sslMode: 'require' }),
      'postgres://u@h/app?sslmode=weird',
    );
    expect(next).toMatchObject({
      url: 'postgres://u@h/app',
      sslMode: 'require',
    });
  });
});

describe('validate', () => {
  const errorsOf = (s: FormState) => {
    const result = validate(s);
    if ('params' in result) throw new Error('valid');
    return result.errors;
  };

  test('fields become connection parameters, with the port as a number and the SSL default', () => {
    expect(validate(state({ password: 'pw' }))).toEqual({
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
    expect(validate(state({ host: ' db.example.com ' }))).toMatchObject({
      params: { host: 'db.example.com', sslMode: 'require' },
    });
  });

  test('an empty password is no password', () => {
    expect(validate(state())).not.toHaveProperty('params.password');
  });

  test('each missing or bad field has its own message', () => {
    expect(
      errorsOf(state({ host: ' ', user: '', database: '', port: '' })),
    ).toEqual({
      host: 'Enter a host',
      user: 'Enter a user',
      database: 'Enter a database name',
      port: 'Enter a port between 1 and 65535',
    });
    for (const port of ['0', '65536', '5432.5', 'abc', '-1'])
      expect(errorsOf(state({ port })).port, port).toBe(
        'Enter a port between 1 and 65535',
      );
  });

  test('verify-full asks for the CA file, and the other modes do not', () => {
    expect(errorsOf(state({ sslMode: 'verify-full' }))).toEqual({
      sslCaPath: 'Choose the CA certificate file',
    });
    expect(
      validate(state({ sslMode: 'verify-full', sslCaPath: '/etc/ca.pem' })),
    ).toMatchObject({
      params: { sslMode: 'verify-full', sslCaPath: '/etc/ca.pem' },
    });
    expect(validate(state({ sslMode: 'require' }))).not.toHaveProperty(
      'errors',
    );
  });

  test('a remote host with the default needs no CA file, since the default is require', () => {
    expect(validate(state({ host: 'db.example.com' }))).toMatchObject({
      params: { sslMode: 'require' },
    });
  });

  test('socket mode gives a socket connection and wants a directory', () => {
    const socket = withMode(state(), 'socket', defaults);
    expect(validate(socket)).toEqual({
      params: {
        kind: 'socket',
        host: '/var/run/postgresql',
        port: 5432,
        user: 'tester',
        database: 'app',
        sslMode: 'disable',
      },
    });
    expect(errorsOf({ ...socket, host: 'localhost' }).host).toBe(
      'The socket directory is a path starting with /',
    );
    expect(errorsOf({ ...socket, host: '' }).host).toBe(
      'Enter the socket directory',
    );
  });

  test('a connection string gives its database from the path, and says what is missing', () => {
    const url = (text: string) =>
      state({ mode: 'url', url: text, database: '' });
    expect(validate(url(' postgres://u:pw@h:5432/my%20db '))).toEqual({
      params: {
        kind: 'url',
        url: 'postgres://u:pw@h:5432/my%20db',
        database: 'my db',
        sslMode: 'require',
      },
    });
    expect(errorsOf(url('')).url).toBe('Enter a connection string');
    expect(errorsOf(url('mysql://h/db')).url).toBe(
      'A connection string starts with postgres:// or postgresql://',
    );
    expect(errorsOf(url('postgres://u@h')).url).toBe(
      'Add the database to the connection string (…/database)',
    );
  });
});
