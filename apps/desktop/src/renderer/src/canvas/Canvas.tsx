import { Background, Controls, ReactFlow, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo } from 'react';
import { useSchemaStore } from '@/stores/schema';
import { foreignKeyEdges } from './edges';
import { FkEdge, FkMarkers } from './FkEdge';
import { tableViews, unionOf } from './model-view';
import { TableNode, type TableNodeType } from './TableNode';
import { useAutoLayout } from './use-auto-layout';

// outside the component: React Flow wants the same object on every render
const nodeTypes = { table: TableNode };
const edgeTypes = { fk: FkEdge };

/**
 * Where a table goes until the layout has placed it: a grid, in the order the tables are listed.
 * shortcut: positions are kept in this component's state, so they are lost with it; the layout
 * store (L6) keeps and restores them.
 */
const gridPosition = (index: number) => ({
  x: (index % 3) * 380,
  y: Math.floor(index / 3) * 340,
});

/** Fits the view to the tables once, when the layout first places them. */
function FitWhenLaidOut({ laidOut }: { laidOut: boolean }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (laidOut) void fitView();
  }, [laidOut, fitView]);
  return null;
}

/** Every table of the loaded and the edited schema together, with a line for each foreign key. */
export function Canvas() {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const model = useMemo(() => unionOf(baseline, desired), [baseline, desired]);
  const views = useMemo(() => tableViews(model), [model]);
  const { positions, status } = useAutoLayout(model, views);
  const nodes = useMemo<TableNodeType[]>(
    () =>
      views.map((view, i) => ({
        id: view.id,
        type: 'table',
        position: positions[view.id] ?? gridPosition(i),
        data: view,
      })),
    [views, positions],
  );
  const edges = useMemo(
    () => foreignKeyEdges(model, positions),
    [model, positions],
  );
  return (
    <div data-layout={status} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        fitView
        minZoom={0.1}
      >
        <FkMarkers />
        <FitWhenLaidOut laidOut={status === 'ready'} />
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
