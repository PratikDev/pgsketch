import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uiStore } from '@/stores/ui';
import { RiskSummary } from './RiskSummary';
import { SqlView } from './SqlView';
import { useMigration } from './use-migration';

/**
 * The drawer at the foot of the Editor that Generate SQL opens: the risk summary and the SQL of the
 * edits, which is made again when they change while it is open. When it can't be made, it says why.
 */
export function SqlPanel({
  dbName,
  onSchemaChanged,
}: {
  dbName: string;
  onSchemaChanged: () => Promise<void>;
}) {
  const migration = useMigration(dbName, onSchemaChanged);
  return (
    <section
      aria-label="SQL"
      className="flex h-80 shrink-0 flex-col border-t border-border bg-card"
    >
      <header className="flex items-start gap-4 border-b border-border px-4 py-2">
        <h2 className="shrink-0 text-sm font-medium">SQL</h2>
        <div className="min-w-0 flex-1">
          {migration.status === 'ready' && (
            <RiskSummary risks={migration.risks} />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close the SQL panel"
          onClick={() => uiStore.getState().setSqlPanelOpen(false)}
        >
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {migration.status === 'ready' && (
          <SqlView text={migration.migration.text} />
        )}
        {migration.status === 'working' && (
          <p className="p-4 text-sm text-muted-foreground">Generating…</p>
        )}
        {migration.status === 'blocked' && (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {migration.reason}
          </p>
        )}
        {migration.status === 'failed' && (
          <p role="alert" className="p-4 text-sm text-destructive">
            Couldn't generate the SQL: {migration.message}
          </p>
        )}
      </div>
    </section>
  );
}
