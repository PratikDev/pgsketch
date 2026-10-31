import { fingerprint, introspectCasts } from '@pgsketch/core';
import { loadSchema } from '../services/introspector';
import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

export function registerSchema(ipc: IpcRegistry, { session }: IpcDeps): void {
  const open = () => {
    const active = session.current();
    if (!active) throw new Error('No database is open');
    return active;
  };

  registerIpc(ipc, 'schema.load', () => loadSchema(open().connection));

  // read fresh whenever SQL is generated: a type picked since the schema was loaded may need it
  registerIpc(ipc, 'schema.casts', () =>
    open().connection.exclusive((query) => introspectCasts(query)),
  );

  // read now, from the database, and not what the poller last saw
  registerIpc(ipc, 'schema.fingerprint', () =>
    fingerprint(open().connection.query),
  );
}
