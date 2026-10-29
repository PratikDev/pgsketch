import { Handle, Position } from '@xyflow/react';
import { LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ROW_HEIGHT } from '@/layout/autoLayout';
import { cn } from '@/lib/utils';
import { handleId } from './edges';
import type { ColumnView } from './model-view';
import { InlineText } from '@/editors/InlineText';
import { TypePicker } from '@/editors/TypePicker';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { addColumnAndEdit, restoreColumn } from './column-actions';
import { KeyBadges } from './KeyBadges';
import { RowMenu } from './RowMenu';
import { isEditable, stateClasses, stateTitle } from './object-state';

/** One column of a table: its name, type, what it is (PK, NN, UQ), its default and where it points. */
export function ColumnRow({
  column,
  last = false,
}: {
  column: ColumnView;
  /** The last row of its table: Enter there goes on to a new column. */
  last?: boolean;
}) {
  const editable = isEditable(column.state);
  const removed = column.state.status?.status === 'removed';
  return (
    <li
      style={{ height: ROW_HEIGHT }}
      title={stateTitle(column.state)}
      data-status={column.state.status?.status}
      aria-invalid={column.state.error !== null || undefined}
      // a removed row is brought back by a click
      onClick={
        removed ? () => restoreColumn(column.id, column.tableId) : undefined
      }
      className={cn(
        'group/row relative flex items-center gap-2 px-3 text-sm',
        removed && 'cursor-pointer',
        stateClasses(column.state),
      )}
    >
      <InlineText
        id={`${column.id}:name`}
        label="Column name"
        value={column.name}
        disabled={!editable}
        onCommit={(name) =>
          schemaStore.getState().renameColumn(column.id, name)
        }
        onSubmit={last ? () => addColumnAndEdit(column.tableId) : undefined}
        // a column made by Enter that is given up on goes away again
        onCancel={() => {
          if (uiStore.getState().addedColumn === column.id)
            schemaStore.getState().removeColumn(column.id);
        }}
        className="max-w-28 shrink-0 font-medium"
      />
      <TypePicker
        id={column.id}
        value={column.pgType}
        disabled={!editable}
        onChange={(type) =>
          schemaStore.getState().setColumnType(column.id, type)
        }
        className="text-muted-foreground"
      />
      {/* the chips give up room first, so the name, the type and the switches stay readable */}
      <span className="flex min-w-0 shrink-3 items-center gap-1">
        {column.default !== null && (
          <Badge
            variant="outline"
            title={`Default: ${column.default}`}
            className="min-w-0 shrink justify-start truncate"
          >
            = {column.default}
          </Badge>
        )}
        {column.references.map((target) => (
          <Badge
            key={target}
            variant="outline"
            title={`Foreign key to ${target}`}
            className="min-w-0 shrink justify-start truncate"
          >
            → {target}
          </Badge>
        ))}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {column.state.readOnly && (
          <LockIcon aria-label="Read-only" className="size-3.5" />
        )}
        <KeyBadges column={column} editable={editable} />
        {!column.state.readOnly && <RowMenu column={column} />}
      </span>
      {/* the four ends a foreign key line can have on this row: either side, starting or ending */}
      {(['left', 'right'] as const).flatMap((side) =>
        (['source', 'target'] as const).map((role) => (
          <Handle
            key={`${side}-${role}`}
            id={handleId(column.id, side, role)}
            type={role}
            position={side === 'left' ? Position.Left : Position.Right}
            isConnectable={false}
            className="size-2! border-border! bg-muted-foreground!"
          />
        )),
      )}
    </li>
  );
}
