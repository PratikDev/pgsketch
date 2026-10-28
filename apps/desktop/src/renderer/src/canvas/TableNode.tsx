import type { Node, NodeProps } from '@xyflow/react';
import { HEADER_HEIGHT, NODE_WIDTH, PADDING } from '@/layout/autoLayout';
import { ColumnRow } from './ColumnRow';
import type { TableView } from './model-view';

export type TableNodeType = Node<TableView, 'table'>;

/** A table on the canvas: `schema.table` over its columns. */
export function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <section
      aria-label={`${data.schema}.${data.name}`}
      style={{ width: NODE_WIDTH }}
      className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
    >
      <header
        style={{ height: HEADER_HEIGHT }}
        className="flex items-center truncate border-b border-border px-3 font-medium"
      >
        <span className="text-muted-foreground">{data.schema}.</span>
        {data.name}
      </header>
      <ul style={{ padding: PADDING / 2 }}>
        {data.columns.map((column) => (
          <ColumnRow key={column.id} column={column} />
        ))}
      </ul>
    </section>
  );
}
