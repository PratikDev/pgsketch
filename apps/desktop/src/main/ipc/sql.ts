import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

export function registerSql(ipc: IpcRegistry, { session }: IpcDeps): void {
  registerIpc(ipc, 'sql.validate', ({ statements, fingerprint }) => {
    const active = session.current();
    if (!active) throw new Error('No database is open');
    return active.validator.validate(statements, fingerprint);
  });
}
