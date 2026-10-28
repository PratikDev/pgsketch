import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  STUB_HANDLE,
  STUB_HEIGHT,
  STUB_WIDTH,
  type StubNodeType,
} from './edges';

/** The end of a foreign key line whose table is hidden by the schema filter: only the table's name. */
export function StubNode({ data }: NodeProps<StubNodeType>) {
  return (
    <div
      title={`Foreign key to ${data.label}, which is hidden`}
      style={{ width: STUB_WIDTH, height: STUB_HEIGHT }}
      className="flex items-center truncate rounded-md border border-dashed border-border bg-card px-2 text-xs text-muted-foreground"
    >
      → {data.label}
      <Handle
        id={STUB_HANDLE}
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="invisible"
      />
    </div>
  );
}
