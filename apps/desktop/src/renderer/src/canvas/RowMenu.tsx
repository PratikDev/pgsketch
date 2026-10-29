import { MoreHorizontalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { schemaStore } from '@/stores/schema';
import { deleteColumn } from './column-actions';
import type { ColumnView } from './model-view';

/** The `⋯` at the end of a row, which shows when the row is hovered or has focus: delete the column, or bring a removed one back. */
export function RowMenu({ column }: { column: ColumnView }) {
  const removed = column.state.status?.status === 'removed';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Column actions"
          className="nodrag opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {removed ? (
          <DropdownMenuItem
            onSelect={() => schemaStore.getState().restoreColumn(column.id)}
          >
            Restore column
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => deleteColumn(column.id)}
          >
            Delete column
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
