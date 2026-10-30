import { CommentMark, CommentPopover } from '@/editors/CommentPopover';
import { InlineText } from '@/editors/InlineText';
import { SchemaPicker } from '@/editors/SchemaPicker';
import { HEADER_HEIGHT, NODE_WIDTH, PADDING } from '@/layout/autoLayout';
import { cn } from '@/lib/utils';
import { schemaStore } from '@/stores/schema';
import type { Node, NodeProps } from '@xyflow/react';
import { LockIcon } from 'lucide-react';
import { useState } from 'react';
import { ColumnRow } from './ColumnRow';
import { NodeFooter } from './NodeFooter';
import type { TableView } from './model-view';
import { isEditable, stateClasses, stateTitle } from './object-state';
import { TableToolbar } from './TableToolbar';

export type TableNodeType = Node<TableView, 'table'>;

/** A table on the canvas: `schema.table` over its columns. */
export function TableNode({ data, selected }: NodeProps<TableNodeType>) {
  const [hovered, setHovered] = useState(false);
  const removed = data.state.status?.status === 'removed';
  const toolbarShown = selected || hovered;
  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TableToolbar table={data} visible={toolbarShown} />
      {/* The toolbar floats a few pixels above the table. This strip covers that gap and half of
          the toolbar, so the pointer is still over the table on its way up to the toolbar. */}
      {toolbarShown && (
        <div
          aria-hidden="true"
          data-slot="toolbar-safe-zone"
          className="absolute inset-x-0 bottom-full h-14"
        />
      )}
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
          // a removed table is brought back by a click
          onClick={
            removed
              ? () => schemaStore.getState().restoreTable(data.id)
              : undefined
          }
          className={cn(
            'relative flex items-center truncate border-b border-border px-3 font-medium',
            removed && 'cursor-pointer',
          )}
        >
          <SchemaPicker table={data} />
          <InlineText
            id={`${data.id}:name`}
            label="Table name"
            value={data.name}
            disabled={!isEditable(data.state)}
            onCommit={(name) =>
              schemaStore.getState().renameTable(data.id, name)
            }
          />
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {data.comment !== null && (
              <CommentMark id={data.id} comment={data.comment} />
            )}
            {data.state.readOnly && (
              <LockIcon aria-label="Read-only" className="size-4" />
            )}
          </span>
          <CommentPopover
            id={data.id}
            label={`${data.schema}.${data.name}`}
            comment={data.comment}
            onSave={(comment) =>
              schemaStore.getState().setTableComment(data.id, comment)
            }
          />
        </header>
        <ul style={{ padding: PADDING / 2 }}>
          {data.columns.map((column, i) => (
            <ColumnRow
              key={column.id}
              column={column}
              last={i === data.columns.length - 1}
            />
          ))}
        </ul>
        <NodeFooter table={data} />
      </section>
    </div>
  );
}
