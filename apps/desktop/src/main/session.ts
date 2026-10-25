import type { SessionInfo } from '../shared/ipc-contract';
import type { ServerConnection } from './services/connection';

export interface ActiveSession {
  connection: ServerConnection;
  info: SessionInfo;
}

/** The one database a window has open, with its main connection. */
export function createSession() {
  let active: ActiveSession | null = null;
  return {
    current: (): ActiveSession | null => active,

    /** Makes this the open database, closing the one it replaces. */
    async replace(next: ActiveSession): Promise<void> {
      const previous = active;
      active = next;
      await previous?.connection.close().catch(() => undefined);
    },

    /** Closes the open database, if there is one. */
    async close(): Promise<void> {
      const previous = active;
      active = null;
      await previous?.connection.close().catch(() => undefined);
    },

    /** Forgets a connection that broke by itself, only if it is still the open one. */
    lost(connection: ServerConnection): boolean {
      if (active?.connection !== connection) return false;
      active = null;
      return true;
    },
  };
}

export type Session = ReturnType<typeof createSession>;
