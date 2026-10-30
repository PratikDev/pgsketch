import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  connectionParamsSchema,
  IPC_CHANNELS,
  IPC_EVENTS,
  ipcInputs,
  type IpcArgs,
  type IpcChannel,
  type IpcInputs,
  type IpcResults,
} from './ipc-contract';

const params = {
  kind: 'params',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'secret',
  database: 'app',
  sslMode: 'disable',
} as const;

const column = {
  id: 'c:1:1',
  name: 'a',
  type: { name: 'integer', isArray: false },
};

/** For every channel: inputs that must parse, and inputs that must be rejected. */
const examples: Record<IpcChannel, { valid: unknown[]; invalid: unknown[] }> = {
  'app.ping': {
    valid: [{ message: 'hi' }, { message: '' }],
    invalid: [undefined, {}, { message: 1 }, 'hi', null],
  },
  'connection.defaults': { valid: [undefined], invalid: [{}, 'x'] },
  'connection.test': {
    valid: [params],
    invalid: [undefined, {}, { ...params, port: 0 }],
  },
  'connection.open': {
    valid: [
      { params, remember: true },
      {
        params: {
          kind: 'url',
          url: 'postgres://u@h/db',
          database: 'db',
          sslMode: 'prefer',
        },
        remember: false,
      },
    ],
    invalid: [{ params }, { remember: true }, { params: {}, remember: true }],
  },
  'connection.openSaved': {
    valid: [{ connectionId: 'abc' }],
    invalid: [{}, { connectionId: '' }, { connectionId: 7 }],
  },
  'connection.reconnect': { valid: [undefined], invalid: [{}, 'x'] },
  'connection.close': { valid: [undefined], invalid: [{}] },
  'connection.recent': { valid: [undefined], invalid: [1] },
  'connection.forget': {
    valid: [{ connectionId: 'abc' }],
    invalid: [{}, { connectionId: '' }],
  },
  'schema.load': { valid: [undefined], invalid: [{}] },
  'schema.fingerprint': { valid: [undefined], invalid: [{}] },
  'schema.casts': { valid: [undefined], invalid: [{}] },
  'expr.normalize': {
    valid: [
      {
        expression: 'now()',
        target: { kind: 'default', columnId: 'c:1:1' },
        columns: [column],
      },
      { expression: 'a > 0', target: { kind: 'check' }, columns: [column] },
    ],
    invalid: [
      { expression: 'now()', target: { kind: 'default' }, columns: [column] },
      { expression: 'x', target: { kind: 'other' }, columns: [] },
      {
        expression: 'x',
        target: { kind: 'check' },
        columns: [{ ...column, type: { name: 'integer' } }],
      },
      { expression: 5, target: { kind: 'check' }, columns: [] },
    ],
  },
  'sql.validate': {
    valid: [
      { statements: ['SELECT 1', 'SELECT 2'], fingerprint: 'abc' },
      { statements: [], fingerprint: 'abc' },
    ],
    invalid: [
      { statements: 'SELECT 1', fingerprint: 'abc' },
      { statements: [1], fingerprint: 'abc' },
      { statements: [] },
    ],
  },
  'sql.save': {
    valid: [{ text: 'SELECT 1', suggestedName: '20260101_pgsketch.sql' }],
    invalid: [{ text: 'x' }, { text: 'x', suggestedName: '' }],
  },
  'draft.get': { valid: [{ dbKey: 'k' }], invalid: [{}, { dbKey: '' }] },
  'draft.put': {
    valid: [{ dbKey: 'k', draft: { fingerprint: 'f', desiredJson: '{}' } }],
    invalid: [
      { dbKey: 'k' },
      { dbKey: 'k', draft: { fingerprint: 'f' } },
      { dbKey: 'k', draft: { fingerprint: '', desiredJson: '{}' } },
    ],
  },
  'draft.clear': { valid: [{ dbKey: 'k' }], invalid: [{}] },
  'layout.get': {
    valid: [
      { dbKey: 'k', tableIds: ['t:1', 't:2'] },
      { dbKey: 'k', tableIds: [] },
    ],
    invalid: [
      {},
      { dbKey: 'k' },
      { dbKey: '', tableIds: [] },
      { dbKey: 'k', tableIds: [''] },
      { dbKey: 'k', tableIds: 't:1' },
    ],
  },
  'layout.put': {
    valid: [
      { dbKey: 'k', positions: { 't:1': { x: 1, y: -2.5 } } },
      { dbKey: 'k', positions: {} },
    ],
    invalid: [
      { dbKey: 'k', positions: { 't:1': { x: 1 } } },
      { dbKey: 'k', positions: { 't:1': { x: 'a', y: 2 } } },
      { dbKey: 'k' },
    ],
  },
};

describe('the channels', () => {
  test('are the ones in the plan, each with a schema', () => {
    expect([...IPC_CHANNELS].sort()).toEqual(Object.keys(examples).sort());
    for (const channel of IPC_CHANNELS)
      expect(ipcInputs[channel]).toBeDefined();
    expect(IPC_EVENTS).toEqual(['schema:changed', 'connection:lost']);
  });

  test.each(Object.entries(examples))(
    '%s accepts valid input and rejects malformed input',
    (channel, { valid, invalid }) => {
      const schema = ipcInputs[channel as IpcChannel];
      for (const input of valid)
        expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(
          true,
        );
      for (const input of invalid)
        expect(schema.safeParse(input).success, JSON.stringify(input)).toBe(
          false,
        );
    },
  );
});

describe('connection parameters', () => {
  const parse = (value: unknown) => connectionParamsSchema.safeParse(value);

  test('verify-full needs a CA file, the other modes do not', () => {
    expect(parse({ ...params, sslMode: 'verify-full' }).success).toBe(false);
    expect(
      parse({ ...params, sslMode: 'verify-full', sslCaPath: '/etc/ca.pem' })
        .success,
    ).toBe(true);
    for (const sslMode of ['disable', 'prefer', 'require'])
      expect(parse({ ...params, sslMode }).success).toBe(true);
  });

  test('ports, SSL modes and kinds are checked', () => {
    for (const port of [0, 65536, 5432.5, -1, '5432'])
      expect(parse({ ...params, port }).success, String(port)).toBe(false);
    expect(parse({ ...params, sslMode: 'verify-ca' }).success).toBe(false);
    expect(parse({ ...params, kind: 'other' }).success).toBe(false);
  });

  test('a socket is a directory, and its user is required', () => {
    const socket = {
      kind: 'socket',
      host: '/var/run/postgresql',
      port: 5432,
      user: 'me',
      database: 'app',
      sslMode: 'disable',
    };
    expect(parse(socket).success).toBe(true);
    expect(parse({ ...socket, host: 'localhost' }).success).toBe(false);
    expect(parse({ ...socket, user: '' }).success).toBe(false);
  });

  test('unknown fields are dropped, not passed on', () => {
    const result = parse({ ...params, extra: 'x' });
    expect(result.success && 'extra' in result.data).toBe(false);
  });
});

describe('types', () => {
  test('a channel with no input is called with no arguments', () => {
    expectTypeOf<IpcArgs<'schema.load'>>().toEqualTypeOf<[]>();
    expectTypeOf<IpcArgs<'app.ping'>>().toEqualTypeOf<
      [input: { message: string }]
    >();
    expectTypeOf<
      IpcInputs['connection.open']['remember']
    >().toEqualTypeOf<boolean>();
    expectTypeOf<IpcResults['connection.recent'][number]>().not.toHaveProperty(
      'password',
    );
  });
});
