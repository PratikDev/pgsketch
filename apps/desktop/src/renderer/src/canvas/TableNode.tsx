import type { Node, NodeProps } from '@xyflow/react';
import { ColumnRow } from './ColumnRow';
import type { TableView } from './model-view';

export type TableNodeType = Node<TableView, 'table'>;

/** A table on the canvas: `schema.table` over its columns. */
export function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <section
      aria-label={`${data.schema}.${data.name}`}
      className="min-w-64 rounded-lg border border-border bg-card text-card-foreground shadow-sm"
    >
      <header className="border-b border-border px-3 py-2 font-medium">
        <span className="text-muted-foreground">{data.schema}.</span>
        {data.name}
      </header>
      <ul className="py-1">
        {data.columns.map((column) => (
          <ColumnRow key={column.id} column={column} />
        ))}
      </ul>
    </section>
  );
}
