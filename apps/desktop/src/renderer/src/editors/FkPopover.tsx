import type { FkAction, Id, SchemaModel } from '@pgsketch/core';
import { useMemo } from 'react';
import { unionOf } from '@/canvas/model-view';
import { READ_ONLY_LABELS } from '@/canvas/object-state';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDerived } from '@/stores/derived';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';

const ACTIONS: FkAction[] = [
  'no action',
  'restrict',
  'cascade',
  'set null',
  'set default',
];

/** The key as people read it: `invoices.user_id → users.id`, for the first pair of columns. */
function describe(model: SchemaModel, id: Id): string {
  const key = model.constraints[id];
  if (key?.kind !== 'fk') return '';
  const end = (tableId: Id, columnId: Id | undefined) =>
    `${model.tables[tableId]?.name ?? '?'}.${(columnId && model.columns[columnId]?.name) ?? '?'}`;
  return `${end(key.tableId, key.columnIds[0])} → ${end(key.refTableId, key.refColumnIds[0])}`;
}

/**
 * What can be done to one foreign key, in a popover where its line was clicked: choose what
 * happens on delete and on update, remove it, or bring it back if the change drops it. A key that
 * is read-only can't be changed. It is open while the UI store is editing `<key id>:fk`.
 */
export function FkPopover({ anchor }: { anchor: { x: number; y: number } }) {
  const editing = useUiStore((s) => s.editing);
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const { statuses } = useDerived();
  const model = useMemo(() => unionOf(baseline, desired), [baseline, desired]);
  const id = editing?.endsWith(':fk') ? editing.slice(0, -3) : null;
  const key = id ? model.constraints[id] : undefined;
  if (!id || key?.kind !== 'fk') return null;

  const removed = statuses[id]?.status === 'removed';
  const close = () => uiStore.getState().stopEditing(`${id}:fk`);
  const choose = (which: 'onDelete' | 'onUpdate') => (value: string) =>
    schemaStore
      .getState()
      .setForeignKeyActions(id, { [which]: value as FkAction });

  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverAnchor asChild>
        <div
          style={{
            position: 'fixed',
            left: anchor.x,
            top: anchor.y,
            width: 0,
            height: 0,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        className="nodrag nopan nowheel w-72 gap-3"
      >
        <p className="font-mono text-sm font-medium">{describe(model, id)}</p>
        {removed ? (
          <>
            <p className="text-sm text-muted-foreground">
              The change drops this foreign key.
            </p>
            <Button
              size="sm"
              onClick={() => {
                schemaStore.getState().restoreConstraint(id);
                close();
              }}
            >
              Restore foreign key
            </Button>
          </>
        ) : key.readOnly ? (
          <p className="text-sm text-muted-foreground">
            Read-only: {READ_ONLY_LABELS[key.readOnly]}
          </p>
        ) : (
          <>
            {(['onDelete', 'onUpdate'] as const).map((which) => (
              <label key={which} className="flex flex-col gap-1 text-xs">
                {which === 'onDelete' ? 'On delete' : 'On update'}
                <Select value={key[which]} onValueChange={choose(which)}>
                  <SelectTrigger
                    size="sm"
                    aria-label={
                      which === 'onDelete' ? 'On delete' : 'On update'
                    }
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                schemaStore.getState().removeConstraint(id);
                close();
              }}
            >
              Remove foreign key
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
