import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Canvas } from '@/canvas/Canvas';
import type { SessionInfo } from '../../../../shared/ipc-contract';
import { useLoadSchema } from './use-load-schema';

/** The open database: its tables on the canvas, under a slim bar until the real top bar is built. */
export function Editor({
  session,
  onDisconnect,
}: {
  session: SessionInfo;
  onDisconnect: () => void;
}) {
  const load = useLoadSchema();
  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-border px-4 py-2">
        <h1 className="font-semibold">Editor</h1>
        <p className="text-sm text-muted-foreground">
          Connected to <strong>{session.database}</strong> on {session.host}{' '}
          (Postgres {session.serverVersion}).
        </p>
        {session.saved?.passwordNotSaved && (
          <Alert className="w-auto py-1">
            <AlertDescription>
              The password was not saved: this system has no keyring to keep it
              in.
            </AlertDescription>
          </Alert>
        )}
        <Button variant="outline" className="ml-auto" onClick={onDisconnect}>
          Disconnect
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {load.status === 'loading' && (
          <p className="p-4 text-muted-foreground">Loading the schema…</p>
        )}
        {load.status === 'failed' && (
          <Alert variant="destructive" className="m-4 w-auto">
            <AlertDescription>
              Couldn't load the schema: {load.message}
            </AlertDescription>
          </Alert>
        )}
        {load.status === 'ready' && <Canvas />}
      </div>
    </main>
  );
}
