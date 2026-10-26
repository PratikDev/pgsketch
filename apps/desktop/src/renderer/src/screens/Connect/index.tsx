import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SessionInfo } from '../../../../shared/ipc-contract';
import type { Mode } from './connect-schema';
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
  const { form, defaults, busy } = screen;
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
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="mode"
              listeners={{
                // the local socket is let in by the operating system user, so there is no password
                onChange: ({ value, fieldApi }) => {
                  if (value !== 'socket') return;
                  fieldApi.form.setFieldValue('host', defaults.socketPath);
                  fieldApi.form.setFieldValue('user', defaults.osUser);
                  fieldApi.form.setFieldValue('password', '');
                },
              }}
            >
              {(field) => (
                <Tabs
                  value={field.state.value}
                  onValueChange={(value) => {
                    const picked = MODES.find((m) => m.mode === value);
                    if (picked) field.handleChange(picked.mode);
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
              )}
            </form.Field>
            <ConnectionFields form={form} />
            <SslFields form={form} />
            <form.Field name="remember">
              {(field) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id="remember"
                    checked={field.state.value}
                    onCheckedChange={(checked) =>
                      field.handleChange(checked === true)
                    }
                  />
                  <FieldLabel htmlFor="remember">
                    Remember this connection
                  </FieldLabel>
                </Field>
              )}
            </form.Field>
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
