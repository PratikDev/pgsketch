import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SessionInfo } from '../../../shared/ipc-contract';

/** A stand-in until the editor is built: says which database is open and lets you leave it. */
export function Editor({
  session,
  onDisconnect,
}: {
  session: SessionInfo;
  onDisconnect: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1>Editor</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>
            Connected to <strong>{session.database}</strong> on {session.host}{' '}
            (Postgres {session.serverVersion}).
          </p>
          {session.saved?.passwordNotSaved && (
            <Alert>
              <AlertDescription>
                The password was not saved: this system has no keyring to keep
                it in.
              </AlertDescription>
            </Alert>
          )}
          <Button variant="outline" onClick={onDisconnect}>
            Disconnect
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
