import { toast } from 'sonner';
import { autoLayout } from '@/layout/autoLayout';
import { layoutStore } from '@/stores/layout';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { tableViews, unionOf } from './model-view';
import { linksOf } from './use-auto-layout';
import { messageOf } from '@/lib/errors';

/**
 * Lays out every table again, the ones already placed too, and fits them in the view. The layout
 * otherwise only places the tables that have no place yet, so this is the one way to start over.
 */
export async function arrangeAll(): Promise<void> {
  const { baseline, desired } = schemaStore.getState();
  const model = unionOf(baseline, desired);
  try {
    const placed = await autoLayout(
      tableViews(model).map((v) => ({
        id: v.id,
        columnIds: v.columns.map((c) => c.id),
      })),
      linksOf(model),
    );
    layoutStore.getState().place(placed);
    uiStore.getState().requestFit();
  } catch (error) {
    toast.error(`Couldn't arrange the tables: ${messageOf(error)}`);
  }
}
