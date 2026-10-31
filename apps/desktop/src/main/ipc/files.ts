import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

export function registerFiles(ipc: IpcRegistry, { files }: IpcDeps): void {
  registerIpc(ipc, 'sql.save', ({ text, suggestedName }) =>
    files.save(text, suggestedName),
  );
}
