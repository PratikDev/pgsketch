import { registerApp } from './app';
import { registerConnection } from './connection';
import { registerDrafts } from './drafts';
import { registerExpr } from './expr';
import { registerFiles } from './files';
import { registerLayouts } from './layouts';
import type { IpcDeps } from './deps';
import type { IpcRegistry } from './register';
import { registerSchema } from './schema';
import { registerSql } from './sql';

type RegisterDomain = (ipc: IpcRegistry, deps: IpcDeps) => void;

/** One entry per domain file; adding a channel to a domain never touches this list. */
const domains: RegisterDomain[] = [
  registerApp,
  registerConnection,
  registerDrafts,
  registerExpr,
  registerFiles,
  registerLayouts,
  registerSchema,
  registerSql,
];

export function registerAllIpc(ipc: IpcRegistry, deps: IpcDeps): void {
  for (const register of domains) register(ipc, deps);
}
