import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { HEADER_HEIGHT, NODE_WIDTH } from '@/layout/autoLayout';
import { handleId } from './edges';
import type { TableView } from './model-view';

export type CompactNodeType = Node<TableView, 'compact'>;

/** Below this zoom a table is drawn as a name and a count: its rows would be too small to read. */
export const COMPACT_ZOOM = 0.7;
export const isCompactZoom = (zoom: number): boolean => zoom < COMPACT_ZOOM;

/**
 * A table zoomed far out: its name and how many columns it has. The foreign key lines still need
 * the ends they were drawn to, so every column keeps its handles, all at the middle of the sides.
 */
export function CompactNode({ data }: NodeProps<CompactNodeType>) {
  const count = data.columns.length;
  return (
    <section
      aria-label={`${data.schema}.${data.name}`}
      style={{ width: NODE_WIDTH, height: HEADER_HEIGHT }}
      className="flex items-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-3 text-card-foreground shadow-sm"
    >
      <span className="truncate font-medium">
        <span className="text-muted-foreground">{data.schema}.</span>
        {data.name}
      </span>
      <span className="ml-auto shrink-0 text-sm text-muted-foreground">
        {count} {count === 1 ? 'column' : 'columns'}
      </span>
      {data.columns.flatMap((column) =>
        (['left', 'right'] as const).flatMap((side) =>
          (['source', 'target'] as const).map((role) => (
            <Handle
              key={`${column.id}-${side}-${role}`}
              id={handleId(column.id, side, role)}
              type={role}
              position={side === 'left' ? Position.Left : Position.Right}
              isConnectable={false}
              className="invisible"
            />
          )),
        ),
      )}
    </section>
  );
}
