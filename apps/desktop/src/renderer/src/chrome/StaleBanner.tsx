import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDerived } from '@/stores/derived';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';

/** Reads the schema again and drops the edits: what the database has is what there is. */
async function reload(): Promise<void> {
  try {
    schemaStore.getState().load(await api.schema.load());
  } catch (error) {
    toast.error(
      `Couldn't reload the schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const STALE = 'schema-stale';
const LOST = 'connection-lost';

/**
 * What to tell the user when what is on the canvas can't be trusted, as toasts that stay until the
 * trouble is over: the database changed in a way the edits don't fit (Reload, which asks first,
 * since it throws the edits away), or the connection to it was lost (Reconnect, which keeps the
 * edits and looks at the database again after). They can't be swiped or closed away; the button
 * is the way, or the trouble going by itself (the rest of the SQL was run, the server came back).
 */
export function StaleBanner({
  onReconnected,
}: {
  /** Called once the database is open again. */
  onReconnected: () => void;
}) {
  const stale = useSchemaStore((s) => s.stale);
  const lost = useUiStore((s) => s.connectionLost);
  const { ops } = useDerived();
  const [asking, setAsking] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectedRef = useRef(onReconnected);
  reconnectedRef.current = onReconnected;
  const busy = useRef(false);

  useEffect(() => {
    if (!stale) return void toast.dismiss(STALE);
    toast.warning('The database schema changed outside pgsketch.', {
      id: STALE,
      duration: Infinity,
      dismissible: false,
      action: {
        label: 'Reload',
        onClick: (event) => {
          // the toast stays: the answer to the question decides
          event.preventDefault();
          setAsking(true);
        },
      },
    });
  }, [stale]);

  useEffect(() => {
    if (lost === null) return void toast.dismiss(LOST);
    toast.error(
      `The connection to the database was lost (${lost}). Your edits are kept.`,
      {
        id: LOST,
        duration: Infinity,
        dismissible: false,
        action: {
          label: reconnecting ? 'Reconnecting…' : 'Reconnect',
          onClick: (event) => {
            event.preventDefault();
            void reconnect();
          },
        },
      },
    );
  }, [lost, reconnecting]);

  // the notices go with the Editor
  useEffect(
    () => () => {
      toast.dismiss(STALE);
      toast.dismiss(LOST);
    },
    [],
  );

  async function reconnect(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setReconnecting(true);
    try {
      const result = await api.connection.reconnect();
      if (result.status === 'opened') {
        uiStore.getState().setConnectionLost(null);
        reconnectedRef.current();
      } else toast.error(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    busy.current = false;
    setReconnecting(false);
  }

  return (
    <Dialog open={asking} onOpenChange={setAsking}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Reload and discard {ops.length}{' '}
            {ops.length === 1 ? 'unsaved change' : 'unsaved changes'}?
          </DialogTitle>
          <DialogDescription>
            The schema is read again from the database, and the edits you made
            are thrown away.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setAsking(false);
              void reload();
            }}
          >
            Reload and discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
