import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

export function registerLayouts(ipc: IpcRegistry, { layouts }: IpcDeps): void {
  registerIpc(ipc, 'layout.get', ({ dbKey, tableIds }) => {
    // a table that is gone has no use for its position
    layouts.prune(dbKey, tableIds);
    return layouts.get(dbKey);
  });

  registerIpc(ipc, 'layout.put', ({ dbKey, positions }) => {
    layouts.put(dbKey, positions);
  });
}
