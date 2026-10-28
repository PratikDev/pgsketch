import { Handle, Position } from '@xyflow/react';
import { LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ROW_HEIGHT } from '@/layout/autoLayout';
import { cn } from '@/lib/utils';
import { handleId } from './edges';
import type { ColumnView } from './model-view';
import { stateClasses, stateTitle } from './object-state';

/** One column of a table: its name, type, what it is (PK, NN, UQ), its default and where it points. */
export function ColumnRow({ column }: { column: ColumnView }) {
  return (
    <li
      style={{ height: ROW_HEIGHT }}
      title={stateTitle(column.state)}
      data-status={column.state.status?.status}
      aria-invalid={column.state.error !== null || undefined}
      className={cn(
        'relative flex items-center gap-2 px-3 text-sm',
        stateClasses(column.state),
      )}
    >
      <span className="truncate font-medium">{column.name}</span>
      <span className="truncate text-muted-foreground">{column.type}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {column.default !== null && (
          <Badge
            variant="outline"
            title={`Default: ${column.default}`}
            className="max-w-32 justify-start"
          >
            = {column.default}
          </Badge>
        )}
        {column.references.map((target) => (
          <Badge
            key={target}
            variant="outline"
            title={`Foreign key to ${target}`}
            className="max-w-32 justify-start"
          >
            → {target}
          </Badge>
        ))}
        {column.state.readOnly && (
          <LockIcon aria-label="Read-only" className="size-3.5" />
        )}
        {column.primaryKey && <Badge variant="secondary">PK</Badge>}
        {column.notNull && <Badge variant="secondary">NN</Badge>}
        {column.unique && <Badge variant="secondary">UQ</Badge>}
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
