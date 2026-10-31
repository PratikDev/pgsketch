import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Validate on a server that is not this machine takes locks there, so it asks first. */
export function ConfirmValidateDialog({
  open,
  host,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  host: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Validate on {host}?</DialogTitle>
          <DialogDescription>
            The SQL is run for real inside a transaction that is rolled back, so
            nothing is kept. While it runs it takes locks on the tables it
            changes, which can make other work on that server wait.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Validate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
