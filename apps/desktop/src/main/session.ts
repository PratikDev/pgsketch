import type { SessionInfo } from '../shared/ipc-contract';
import type { ServerConnection } from './services/connection';
import type { Normalizer } from './services/normalizer';

export interface ActiveSession {
  connection: ServerConnection;
  /** Normalizes expressions on a connection of its own, which closes with the session. */
  normalizer: Normalizer;
  info: SessionInfo;
}

/** Closes the connections of a session; one failing to close doesn't stop the other. */
async function closeSession(session: ActiveSession | null): Promise<void> {
  await Promise.all([
    session?.connection.close().catch(() => undefined),
    session?.normalizer.close().catch(() => undefined),
  ]);
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
      await closeSession(previous);
    },

    /** Closes the open database, if there is one. */
    async close(): Promise<void> {
      const previous = active;
      active = null;
      await closeSession(previous);
    },

    /** Forgets a connection that broke by itself, only if it is still the open one. */
    lost(connection: ServerConnection): boolean {
      if (active?.connection !== connection) return false;
      void active.normalizer.close().catch(() => undefined);
      active = null;
      return true;
    },
  };
}

export type Session = ReturnType<typeof createSession>;
