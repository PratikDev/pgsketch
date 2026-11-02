import { Button } from '@/components/ui/button';
import type { SavedConnection } from '../../../../shared/ipc-contract';

interface Props {
  connections: SavedConnection[];
  /** False where there are no sockets: a connection made through one cannot be opened. */
  socketsAvailable: boolean;
  busy: boolean;
  onOpen: (connectionId: string) => void;
}

/** Remembered connections, most recent first; one click opens it, the password never leaves main. */
export function RecentConnections({
  connections,
  socketsAvailable,
  busy,
  onOpen,
}: Props) {
  if (connections.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
      <h2 id="recent-heading" className="text-sm font-medium">
        Recent connections
      </h2>
      <ul className="flex flex-col gap-1.5">
        {connections.map((c) => {
          const unusable = c.kind === 'socket' && !socketsAvailable;
          return (
            <li key={c.id} className="flex flex-col gap-1">
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={busy || unusable}
                onClick={() => onOpen(c.id)}
              >
                {c.label}
              </Button>
              {unusable ? (
                <p className="text-xs text-muted-foreground">
                  Unix sockets are not available on this system.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
