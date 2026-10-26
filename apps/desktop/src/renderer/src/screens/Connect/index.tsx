import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SessionInfo } from '../../../../shared/ipc-contract';
import type { Mode } from './connect-form';
import { ConnectionFields } from './ConnectionFields';
import { RecentConnections } from './RecentConnections';
import { SslFields } from './SslFields';
import { useConnectScreen } from './use-connect-screen';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'fields', label: 'Fields' },
  { mode: 'url', label: 'Connection string' },
  { mode: 'socket', label: 'Local socket' },
];

export function Connect({
  onOpened,
}: {
  onOpened: (session: SessionInfo) => void;
}) {
  const screen = useConnectScreen(onOpened);
  const { state, errors, busy } = screen;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1>Connect to Postgres</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <RecentConnections
            connections={screen.recent}
            busy={busy}
            onOpen={screen.openRecent}
          />
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              screen.submit();
            }}
          >
            <Tabs
              value={state.mode}
              onValueChange={(value) => {
                const picked = MODES.find((m) => m.mode === value);
                if (picked) screen.changeMode(picked.mode);
              }}
            >
              <TabsList>
                {MODES.map(({ mode, label }) => (
                  <TabsTrigger key={mode} value={mode}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <ConnectionFields
              state={state}
              errors={errors}
              onChange={screen.change}
              onUrlChange={screen.changeUrl}
            />
            <SslFields state={state} errors={errors} onChange={screen.change} />
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={state.remember}
                onCheckedChange={(checked) =>
                  screen.change({ remember: checked === true })
                }
              />
              <Label htmlFor="remember">Remember this connection</Label>
            </div>
            {screen.message !== null && (
              <Alert variant="destructive">
                <AlertDescription>{screen.message}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
