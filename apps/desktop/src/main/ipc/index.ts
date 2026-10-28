import { registerApp } from './app';
import { registerConnection } from './connection';
import type { IpcDeps } from './deps';
import type { IpcRegistry } from './register';
import { registerSchema } from './schema';

type RegisterDomain = (ipc: IpcRegistry, deps: IpcDeps) => void;

/** One entry per domain file; adding a channel to a domain never touches this list. */
const domains: RegisterDomain[] = [
  registerApp,
  registerConnection,
  registerSchema,
];

export function registerAllIpc(ipc: IpcRegistry, deps: IpcDeps): void {
  for (const register of domains) register(ipc, deps);
}
