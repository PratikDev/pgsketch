import { loadSchema } from '../services/introspector';
import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

export function registerSchema(ipc: IpcRegistry, { session }: IpcDeps): void {
  registerIpc(ipc, 'schema.load', () => {
    const active = session.current();
    if (!active) throw new Error('No database is open');
    return loadSchema(active.connection);
  });
}
