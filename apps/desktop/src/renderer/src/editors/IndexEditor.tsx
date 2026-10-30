import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useTableColumns } from '@/hooks/use-table-columns';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';

/**
 * A new index on a table: the columns to pick, in the order they are picked (each shows its place
 * in the index), and whether it is unique. Its name is made from the table and the columns.
 */
export function IndexEditor({ tableId }: { tableId: string }) {
  const columns = useTableColumns(tableId);
  const [picked, setPicked] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = () => uiStore.getState().stopEditing(`${tableId}:index`);
  return (
    <div
      role="group"
      aria-label="New index"
      className="nodrag nopan flex flex-col gap-2 p-2"
    >
      <div className="flex flex-wrap gap-1">
        {columns.map((column) => {
          const place = picked.indexOf(column.id) + 1;
          return (
            <Button
              key={column.id}
              size="xs"
              variant={place > 0 ? 'secondary' : 'outline'}
              aria-pressed={place > 0}
              onClick={() => toggle(column.id)}
            >
              {place > 0 && <span className="font-semibold">{place}</span>}
              {column.name}
            </Button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={unique}
          onCheckedChange={(checked) => setUnique(checked === true)}
        />
        Unique
      </label>
      <div className="flex gap-2">
        <Button
          size="xs"
          disabled={picked.length === 0}
          onClick={() => {
            schemaStore.getState().addIndex(tableId, picked, unique);
            close();
          }}
        >
          Add index
        </Button>
        <Button size="xs" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
