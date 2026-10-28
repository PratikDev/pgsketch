import { useDerived } from '@/stores/derived';

/** How many changes the edits make, until the top bar's own counters (O1) replace this. */
export function ChangeCount() {
  const { ops } = useDerived();
  return (
    <p aria-live="polite" className="text-sm text-muted-foreground">
      {ops.length} {ops.length === 1 ? 'change' : 'changes'}
    </p>
  );
}
