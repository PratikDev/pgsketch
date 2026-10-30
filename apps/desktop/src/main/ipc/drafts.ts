import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

export function registerDrafts(ipc: IpcRegistry, { drafts }: IpcDeps): void {
  registerIpc(ipc, 'draft.get', ({ dbKey }) => drafts.get(dbKey));
  registerIpc(ipc, 'draft.put', ({ dbKey, draft }) => {
    drafts.put(dbKey, draft);
  });
  registerIpc(ipc, 'draft.clear', ({ dbKey }) => {
    drafts.clear(dbKey);
  });
}
