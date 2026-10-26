import { Button } from '@/components/ui/button';
import type { SavedConnection } from '../../../../shared/ipc-contract';

interface Props {
  connections: SavedConnection[];
  busy: boolean;
  onOpen: (connectionId: string) => void;
}

/** Remembered connections, most recent first; one click opens it, the password never leaves main. */
export function RecentConnections({ connections, busy, onOpen }: Props) {
  if (connections.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
      <h2 id="recent-heading" className="text-sm font-medium">
        Recent connections
      </h2>
      <ul className="flex flex-col gap-1.5">
        {connections.map((c) => (
          <li key={c.id}>
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={busy}
              onClick={() => onOpen(c.id)}
            >
              {c.label}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
