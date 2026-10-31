import { toast } from 'sonner';
import { api } from '@/api';
import { derived } from '@/stores/derived';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { messageOf } from '@/lib/errors';

/** Reads the schema again and drops the edits: what the database has is what there is. */
export async function reloadSchema(): Promise<void> {
  try {
    schemaStore.getState().load(await api.schema.load());
  } catch (error) {
    toast.error(`Couldn't reload the schema: ${messageOf(error)}`);
  }
}

/** Reload: at once when there are no edits to lose, otherwise after asking. */
export function requestReload(): void {
  const { baseline, desired } = schemaStore.getState();
  if (derived(baseline, desired).ops.length === 0) void reloadSchema();
  else uiStore.getState().setReloadAsked(true);
}
