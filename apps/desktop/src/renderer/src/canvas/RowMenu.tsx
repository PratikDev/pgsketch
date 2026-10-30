import { MoreHorizontalIcon } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { commentKey } from '@/editors/CommentPopover';
import { uiStore } from '@/stores/ui';
import { deleteColumn, restoreColumn } from './column-actions';
import type { ColumnView } from './model-view';

/** The `⋯` at the end of a row, which shows when the row is hovered or has focus: delete the column, or bring a removed one back. */
export function RowMenu({ column }: { column: ColumnView }) {
  const removed = column.state.status?.status === 'removed';
  const commenting = useRef(false);
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
      <DropdownMenuContent
        align="end"
        // The comment opens once the menu has let go of the focus: opened any sooner, the menu
        // takes the focus back from it and it closes at once. Focus then goes to the comment.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!commenting.current) return;
          commenting.current = false;
          uiStore.getState().startEditing(commentKey(column.id));
        }}
      >
        {removed ? (
          <DropdownMenuItem
            onSelect={() => restoreColumn(column.id, column.tableId)}
          >
            Restore column
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => (commenting.current = true)}>
              Comment…
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => deleteColumn(column.id)}
            >
              Delete column
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
