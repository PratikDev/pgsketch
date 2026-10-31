import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { arrangeAll } from '@/canvas/arrange';
import { useDerived } from '@/stores/derived';
import { useSchemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';
import type { SessionInfo } from '../../../shared/ipc-contract';
import { ChangeCount } from './ChangeCount';
import { generateBlocker } from './generate-state';
import { requestReload } from './reload';
import { SchemaFilter } from './SchemaFilter';

/**
 * The bar above the canvas: which database is open, how many changes the edits make (and how many
 * are risky), the schema filter, and Generate SQL, Reload, Auto-arrange and Disconnect. Generate
 * SQL is off while there is nothing to generate or it can't be trusted, and says why on hover.
 */
export function TopBar({
  session,
  ready,
  onDisconnect,
}: {
  session: SessionInfo;
  /** The schema has been loaded. */
  ready: boolean;
  onDisconnect: () => void;
}) {
  const { ops, errors } = useDerived();
  const stale = useSchemaStore((s) => s.stale);
  const lost = useUiStore((s) => s.connectionLost);
  const blocker = ready
    ? generateBlocker({ changes: ops.length, errors, stale, lost })
    : 'The schema is still loading.';
  return (
    <header className="flex items-center gap-4 border-b border-border px-4 py-2">
      <h1 className="sr-only">Editor</h1>
      <p className="text-sm">
        <strong>{session.database}</strong>{' '}
        <span className="text-muted-foreground">
          on {session.host} · Postgres {session.serverVersion}
        </span>
      </p>
      {session.saved?.passwordNotSaved && (
        <Alert className="w-auto py-1">
          <AlertDescription>
            The password was not saved: this system has no keyring to keep it
            in.
          </AlertDescription>
        </Alert>
      )}
      <div className="ml-auto flex items-center gap-3">
        {ready && <ChangeCount />}
        {ready && <SchemaFilter />}
        <Button variant="outline" disabled={!ready} onClick={requestReload}>
          Reload
        </Button>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() => void arrangeAll()}
        >
          Auto-arrange
        </Button>
        {/* a disabled button shows no tooltip, so the reason is on what holds it */}
        <span title={blocker ?? undefined}>
          <Button
            disabled={blocker !== null}
            onClick={() => uiStore.getState().setSqlPanelOpen(true)}
          >
            Generate SQL
          </Button>
        </span>
        <Button variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
    </header>
  );
}
