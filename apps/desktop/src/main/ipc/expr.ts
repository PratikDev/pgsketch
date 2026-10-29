import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

export function registerExpr(ipc: IpcRegistry, { session }: IpcDeps): void {
  registerIpc(ipc, 'expr.normalize', (request) => {
    const active = session.current();
    if (!active) throw new Error('No database is open');
    return active.normalizer.normalize(request);
  });
}
