import type { Node, NodeProps } from '@xyflow/react';
import { LockIcon } from 'lucide-react';
import { HEADER_HEIGHT, NODE_WIDTH, PADDING } from '@/layout/autoLayout';
import { cn } from '@/lib/utils';
import { ColumnRow } from './ColumnRow';
import { InlineText } from '@/editors/InlineText';
import { schemaStore } from '@/stores/schema';
import { isEditable, stateClasses, stateTitle } from './object-state';
import type { TableView } from './model-view';

export type TableNodeType = Node<TableView, 'table'>;

/** A table on the canvas: `schema.table` over its columns. */
export function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <section
      aria-label={`${data.schema}.${data.name}`}
      style={{ width: NODE_WIDTH }}
      title={stateTitle(data.state)}
      data-status={data.state.status?.status}
      aria-invalid={data.state.error !== null || undefined}
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        stateClasses(data.state),
      )}
    >
      <header
        style={{ height: HEADER_HEIGHT }}
        className="flex items-center truncate border-b border-border px-3 font-medium"
      >
        <span className="text-muted-foreground">{data.schema}.</span>
        <InlineText
          id={`${data.id}:name`}
          label="Table name"
          value={data.name}
          disabled={!isEditable(data.state)}
          onCommit={(name) => schemaStore.getState().renameTable(data.id, name)}
        />
        {data.state.readOnly && (
          <LockIcon
            aria-label="Read-only"
            className="ml-auto size-4 shrink-0"
          />
        )}
      </header>
      <ul style={{ padding: PADDING / 2 }}>
        {data.columns.map((column) => (
          <ColumnRow key={column.id} column={column} />
        ))}
      </ul>
    </section>
  );
}
