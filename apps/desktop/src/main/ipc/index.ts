import { registerApp } from './app';
import type { IpcRegistry } from './register';

type RegisterDomain = (ipc: IpcRegistry) => void;

/** One entry per domain file; adding a channel to a domain never touches this list. */
const domains: RegisterDomain[] = [registerApp];

export function registerAllIpc(ipc: IpcRegistry): void {
  for (const register of domains) register(ipc);
}
