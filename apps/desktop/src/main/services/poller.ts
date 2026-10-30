/** How often the fingerprint of the open database is read; a change is seen within about this. */
export const POLL_INTERVAL_MS = 3_000;

export interface Poller {
  /** Resolves once the first reading is made, which is the one later ones are compared with. */
  readonly ready: Promise<void>;
  stop(): void;
}

/**
 * Reads the fingerprint of the database every `intervalMs` and calls `onChange` once for each
 * change from the one before it (the first reading is only remembered). Readings never overlap:
 * the next waits until the last has finished. A reading that fails is skipped, so one slow or
 * broken moment doesn't end the polling; a broken connection is the session's business.
 *
 * This only decides when to look. Whether a draft or a SQL script still fits the database is
 * decided by comparing fingerprints at the time, never by what the poller has seen.
 */
export function startPoller(
  read: () => Promise<string>,
  onChange: () => void,
  intervalMs = POLL_INTERVAL_MS,
): Poller {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: string | undefined;

  const check = async (): Promise<void> => {
    try {
      const now = await read();
      if (stopped) return;
      if (last !== undefined && now !== last) onChange();
      last = now;
    } catch {
      // skipped: the next one will try again
    }
    if (!stopped) {
      timer = setTimeout(() => void check(), intervalMs);
      // a poller must not keep the app from quitting
      timer.unref();
    }
  };

  return {
    ready: check(),
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
