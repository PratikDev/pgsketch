import type { IpcEvent, IpcEvents } from '../../shared/ipc-contract';
import type { Session } from '../session';
import type { openConnection } from '../services/connection';
import type { Secrets } from '../services/secrets';
import type { openTaskConnection } from '../services/task-connection';
import type { ConnectionsRepo } from '../store/connections';
import type { DraftsRepo } from '../store/drafts';
import type { LayoutsRepo } from '../store/layouts';

/** Sends an event to every window. */
export type EmitEvent = <E extends IpcEvent>(
  event: E,
  ...payload: IpcEvents[E] extends void ? [] : [IpcEvents[E]]
) => void;

/** What the handlers of every domain are built on. */
export interface IpcDeps {
  connections: ConnectionsRepo;
  layouts: LayoutsRepo;
  drafts: DraftsRepo;
  secrets: Secrets;
  session: Session;
  emit: EmitEvent;
  /** The way connections are opened; tests pass one that needs no server. */
  open: typeof openConnection;
  /** The way the connections for expression normalization are opened. */
  openTask: typeof openTaskConnection;
  /** The operating system user, for the local socket's default. */
  /** How often the open database is looked at for changes from outside. */
  pollMs: number;
  osUser: string;
  socketPath: string;
}
