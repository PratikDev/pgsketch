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
import { uiStore, useUiStore } from '@/stores/ui';
import { reloadSchema } from './reload';

/** "Reload and discard N unsaved changes?", asked before the edits are thrown away. */
export function ReloadDialog() {
  const asked = useUiStore((s) => s.reloadAsked);
  const { ops } = useDerived();
  const close = () => uiStore.getState().setReloadAsked(false);
  return (
    <Dialog open={asked} onOpenChange={(open) => !open && close()}>
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
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              close();
              void reloadSchema();
            }}
          >
            Reload and discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
