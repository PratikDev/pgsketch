import type { NormalizedExpression } from '@pgsketch/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExpressionInput } from '@/editors/ExpressionInput';
import { useTableColumns } from '@/hooks/use-table-columns';
import { schemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';

/**
 * A new check on a table: an expression Postgres reads as it is typed, which also says which
 * columns it uses. When the database role can't create temporary tables there is no way to know
 * that, so checks can't be added, and this says so instead.
 */
export function CheckEditor({ tableId }: { tableId: string }) {
  const columns = useTableColumns(tableId);
  const fallback = useUiStore((s) => s.normalizationFallback);
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<NormalizedExpression | null>(null);
  const close = () => uiStore.getState().stopEditing(`${tableId}:check`);
  const ready = answer?.status === 'normalized' ? answer : null;
  return (
    <div
      role="group"
      aria-label="New check"
      className="nodrag nopan flex flex-col gap-2 p-2"
    >
      {fallback ? (
        <p role="alert" className="text-xs text-muted-foreground">
          Checks can't be added here: this database role can't create temporary
          tables, so pgsketch can't tell which columns an expression uses.
        </p>
      ) : (
        <ExpressionInput
          label="Check expression"
          value={text}
          onChange={setText}
          target={{ kind: 'check' }}
          columns={columns}
          onAnswer={setAnswer}
          placeholder="price > 0"
        />
      )}
      <div className="flex gap-2">
        <Button
          size="xs"
          disabled={fallback || ready === null}
          onClick={() => {
            if (!ready) return;
            schemaStore.getState().addCheck(tableId, {
              expression: ready.expression,
              columnIds: ready.columnIds,
            });
            close();
          }}
        >
          Add check
        </Button>
        <Button size="xs" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
