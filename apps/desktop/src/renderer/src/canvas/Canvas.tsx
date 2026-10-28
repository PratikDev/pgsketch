import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { useSchemaStore } from '@/stores/schema';
import { tableViews, unionOf } from './model-view';
import { TableNode, type TableNodeType } from './TableNode';

// outside the component: React Flow wants the same object on every render
const nodeTypes = { table: TableNode };

/**
 * Where a table goes until there is a layout: a grid, in the order the tables are listed.
 * shortcut: a plain grid, replaced by the auto-layout (L4) and saved positions (L6).
 */
const gridPosition = (index: number) => ({
  x: (index % 3) * 380,
  y: Math.floor(index / 3) * 340,
});

/** Every table of the loaded and the edited schema together, one node each. */
export function Canvas() {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const nodes = useMemo<TableNodeType[]>(
    () =>
      tableViews(unionOf(baseline, desired)).map((view, i) => ({
        id: view.id,
        type: 'table',
        position: gridPosition(i),
        data: view,
      })),
    [baseline, desired],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      nodesConnectable={false}
      nodesDraggable={false}
      fitView
      minZoom={0.1}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
