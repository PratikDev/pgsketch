import { useEffect } from 'react';
import { toast } from 'sonner';
import { Canvas } from '@/canvas/Canvas';
import { StaleBanner } from '@/chrome/StaleBanner';
import { ReloadDialog } from '@/chrome/ReloadDialog';
import { TopBar } from '@/chrome/TopBar';
import { layoutStore } from '@/stores/layout';
import { persistence } from '@/stores/persistence';
import { SqlPanel } from '@/sql/SqlPanel';
import { uiStore, useUiStore } from '@/stores/ui';
import type { SessionInfo } from '../../../../shared/ipc-contract';
import { useLoadSchema } from './use-load-schema';
import { useSchemaChanges } from './use-schema-changes';

/** The open database: its tables on the canvas, under the top bar. */
export function Editor({
  session,
  onDisconnect,
}: {
  session: SessionInfo;
  onDisconnect: () => void;
}) {
  const load = useLoadSchema(session.dbKey);
  const onSchemaChanged = useSchemaChanges(load.status === 'ready');
  const sqlOpen = useUiStore((s) => s.sqlPanelOpen);
  // a schema that could not be read is said once, and stays until the Editor goes
  useEffect(() => {
    if (load.status !== 'failed') return;
    const message = `Couldn't load the schema: ${load.message}`;
    toast.error(message, { id: 'load-failed', duration: Infinity });
    return () => void toast.dismiss('load-failed');
  }, [load]);
  // what was moved or edited a moment ago is saved before the Editor goes, or the window closes
  useEffect(() => {
    const flush = () => {
      void layoutStore.getState().flush();
      void persistence.flush();
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      void layoutStore.getState().flush();
      void persistence.stop();
      uiStore.getState().setSqlPanelOpen(false);
    };
  }, []);
  return (
    <main className="flex h-screen flex-col">
      <TopBar
        session={session}
        ready={load.status === 'ready'}
        onDisconnect={onDisconnect}
      />
      <ReloadDialog />
      <StaleBanner onReconnected={() => void onSchemaChanged()} />
      <div className="min-h-0 flex-1">
        {load.status === 'loading' && (
          <p className="p-4 text-muted-foreground">Loading the schema…</p>
        )}
        {load.status === 'ready' && <Canvas />}
      </div>
      {sqlOpen && load.status === 'ready' && (
        <SqlPanel session={session} onSchemaChanged={onSchemaChanged} />
      )}
    </main>
  );
}
