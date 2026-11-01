import { NodeToolbar, Position } from '@xyflow/react';
import {
  ListPlusIcon,
  MessageSquareIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react';
import { Hint } from '@/components/Hint';
import { Button } from '@/components/ui/button';
import { showRefusal } from '@/lib/refusal';
import { commentKey } from '@/editors/CommentPopover';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { addColumnAndEdit } from './column-actions';
import type { TableView } from './model-view';
import { isEditable } from './object-state';

/** What can be done to a table as a whole, above it while it is hovered or selected. */
export function TableToolbar({
  table,
  visible,
}: {
  table: TableView;
  visible: boolean;
}) {
  const removed = table.state.status?.status === 'removed';
  if (!isEditable(table.state) && !removed) return null;
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} offset={4}>
      <div
        role="toolbar"
        aria-label={`${table.schema}.${table.name}`}
        className="nodrag flex gap-1 rounded-lg border border-border bg-card p-1 shadow-sm"
      >
        {removed ? (
          <Hint label="Restore table">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Restore table"
              onClick={() => schemaStore.getState().restoreTable(table.id)}
            >
              <RotateCcwIcon />
            </Button>
          </Hint>
        ) : (
          <>
            <Hint label="Add column">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add column"
                onClick={() => addColumnAndEdit(table.id)}
              >
                <PlusIcon />
              </Button>
            </Hint>
            <Hint label="Add index">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add index"
                onClick={() =>
                  uiStore.getState().startEditing(`${table.id}:index`)
                }
              >
                <ListPlusIcon />
              </Button>
            </Hint>
            <Hint label="Add check">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add check"
                onClick={() =>
                  uiStore.getState().startEditing(`${table.id}:check`)
                }
              >
                <ShieldCheckIcon />
              </Button>
            </Hint>
            <Hint label="Comment">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Comment"
                onClick={() =>
                  uiStore.getState().startEditing(commentKey(table.id))
                }
              >
                <MessageSquareIcon />
              </Button>
            </Hint>
            <Hint label="Delete table">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete table"
                onClick={() =>
                  showRefusal(schemaStore.getState().removeTable(table.id))
                }
              >
                <Trash2Icon />
              </Button>
            </Hint>
          </>
        )}
      </div>
    </NodeToolbar>
  );
}
