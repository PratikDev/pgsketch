import { MoreHorizontalIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteColumn, restoreColumn } from './column-actions';
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
          // the row restores a removed column when clicked; the menu does it on its own
          onClick={(event) => event.stopPropagation()}
          className="nodrag opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {removed ? (
          <DropdownMenuItem
            onSelect={() => restoreColumn(column.id, column.tableId)}
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
