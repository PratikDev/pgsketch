import type {
  CastData,
  Introspection,
  NormalizedExpression,
} from '@pgsketch/core';
import { z } from 'zod';

/*
 * Every channel between the renderer and the main process: its name, the schema its input must
 * match (checked in the main process before anything runs) and what it returns. The schemas have
 * no defaults or transforms, so what the renderer sends is exactly what a handler receives.
 */

const id = z.string().min(1);
const text = z.string().min(1);
const point = z.object({ x: z.number(), y: z.number() });

export const SSL_MODES = [
  'disable',
  'prefer',
  'require',
  'verify-full',
] as const;
export const sslModeSchema = z.enum(SSL_MODES);
export type SslMode = z.infer<typeof sslModeSchema>;

const connectionBase = {
  database: text,
  sslMode: sslModeSchema,
  /** The CA certificate file; only `verify-full` uses it, and requires it. */
  sslCaPath: text.optional(),
};

/** How to reach the server: separate fields, one connection string, or a local socket. */
export const connectionParamsSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('params'),
      host: text,
      port: z.int().min(1).max(65535),
      user: text,
      password: z.string().optional(),
      ...connectionBase,
    }),
    z.object({ kind: z.literal('url'), url: text, ...connectionBase }),
    z.object({
      kind: z.literal('socket'),
      /** The directory the socket file is in, like `/var/run/postgresql`. */
      host: z.string().startsWith('/'),
      port: z.int().min(1).max(65535),
      user: text,
      ...connectionBase,
    }),
  ])
  .refine((p) => p.sslMode !== 'verify-full' || p.sslCaPath !== undefined, {
    message: 'verify-full needs a CA certificate file',
    path: ['sslCaPath'],
  });
export type ConnectionParams = z.infer<typeof connectionParamsSchema>;

export const pgTypeSchema = z.object({
  name: text,
  schema: text.optional(),
  params: z.array(z.int().min(0)).optional(),
  isArray: z.boolean(),
});

const expressionColumnSchema = z.object({
  id,
  name: text,
  type: pgTypeSchema,
});

const draftSchema = z.object({
  /** The baseline fingerprint the draft was made on. */
  fingerprint: text,
  /** The edited model as JSON text; the main process stores it without reading it. */
  desiredJson: text,
});

const positionsSchema = z.record(id, point);

/** Input schemas by channel. A channel with no input takes none (`undefined`). */
const schemas = {
  'app.ping': z.object({ message: z.string() }),
  'connection.defaults': z.void(),
  'connection.test': connectionParamsSchema,
  'connection.open': z.object({
    params: connectionParamsSchema,
    remember: z.boolean(),
  }),
  'connection.openSaved': z.object({ connectionId: id }),
  'connection.close': z.void(),
  'connection.recent': z.void(),
  'connection.forget': z.object({ connectionId: id }),
  'schema.load': z.void(),
  'schema.fingerprint': z.void(),
  'schema.casts': z.void(),
  'expr.normalize': z.object({
    expression: z.string(),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('default'), columnId: id }),
      z.object({ kind: z.literal('check') }),
    ]),
    /** Every column of the table, pending ones included. */
    columns: z.array(expressionColumnSchema),
  }),
  'sql.validate': z.object({
    /** One entry per statement, as rendered, so the main process never splits SQL. */
    statements: z.array(z.string()),
    /** The fingerprint the statements were generated for. */
    fingerprint: text,
  }),
  'sql.save': z.object({ text: z.string(), suggestedName: text }),
  'draft.get': z.object({ dbKey: id }),
  'draft.put': z.object({ dbKey: id, draft: draftSchema }),
  'draft.clear': z.object({ dbKey: id }),
  'layout.get': z.object({ dbKey: id }),
  'layout.put': z.object({ dbKey: id, positions: positionsSchema }),
};

export type Draft = z.infer<typeof draftSchema>;
export type Positions = z.infer<typeof positionsSchema>;
export type ExpressionColumnInput = z.infer<typeof expressionColumnSchema>;

export interface ConnectionDefaults {
  osUser: string;
  socketPath: string;
}

export type ConnectionTestResult =
  { ok: true } | { ok: false; message: string };

export interface SessionInfo {
  serverVersion: string;
  database: string;
  host: string;
  /** What kind of server it is, for deciding whether Validate asks first. */
  hostKind: 'local' | 'remote' | 'socket';
  /** Identifies this database for drafts and layouts. */
  dbKey: string;
}

/** A remembered connection; the password is never part of it. */
export interface SavedConnection {
  id: string;
  label: string;
  kind: ConnectionParams['kind'];
  host: string | null;
  port: number | null;
  user: string | null;
  database: string;
  /** Connection-string connections only, password removed. */
  url: string | null;
  sslMode: SslMode;
  sslCaPath: string | null;
  hasPassword: boolean;
  lastUsedAt: number;
}

export type StatementResult =
  | { status: 'passed' }
  | { status: 'failed'; message: string; code: string | null }
  | { status: 'not-run' };

export type ValidateResult =
  /** The schema changed since the statements were generated; nothing was run. */
  { status: 'stale' } | { status: 'done'; results: StatementResult[] };

export type SaveResult =
  { status: 'saved'; path: string } | { status: 'cancelled' };

/** What each channel returns. */
export interface IpcResults {
  'app.ping': { message: string };
  'connection.defaults': ConnectionDefaults;
  'connection.test': ConnectionTestResult;
  'connection.open': SessionInfo;
  'connection.openSaved': SessionInfo;
  'connection.close': void;
  'connection.recent': SavedConnection[];
  'connection.forget': void;
  'schema.load': Introspection;
  'schema.fingerprint': string;
  'schema.casts': CastData;
  'expr.normalize': NormalizedExpression;
  'sql.validate': ValidateResult;
  'sql.save': SaveResult;
  'draft.get': Draft | null;
  'draft.put': void;
  'draft.clear': void;
  'layout.get': Positions;
  'layout.put': void;
}

export type IpcChannel = keyof IpcResults;

/** What each channel takes. */
export type IpcInputs = {
  [C in keyof typeof schemas]: z.infer<(typeof schemas)[C]>;
};

/**
 * The schemas, typed per channel so that looking one up with a channel name gives the schema for
 * exactly that channel. The annotation also makes the compiler check that every channel has both
 * a schema and a result type.
 */
export const ipcInputs: { [C in IpcChannel]: z.ZodType<IpcInputs[C]> } =
  schemas;

export const IPC_CHANNELS = Object.keys(ipcInputs) as IpcChannel[];

/** The arguments of `invoke` for a channel: none when it takes no input. */
export type IpcArgs<C extends IpcChannel> = [IpcInputs[C]] extends [void]
  ? []
  : [input: IpcInputs[C]];

/** Events the main process pushes to the renderer, and what each carries. */
const eventSchemas = {
  'schema:changed': z.void(),
  'connection:lost': z.object({ reason: z.string() }),
};

export type IpcEvents = {
  [E in keyof typeof eventSchemas]: z.infer<(typeof eventSchemas)[E]>;
};
export type IpcEvent = keyof IpcEvents;

export const IPC_EVENTS = Object.keys(eventSchemas) as IpcEvent[];

/** What the preload exposes to the renderer as `window.api`. */
export interface PgsketchApi {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcArgs<C>
  ): Promise<IpcResults[C]>;
  /** Subscribes to an event; the returned function unsubscribes. */
  on<E extends IpcEvent>(
    event: E,
    listener: (payload: IpcEvents[E]) => void,
  ): () => void;
}
