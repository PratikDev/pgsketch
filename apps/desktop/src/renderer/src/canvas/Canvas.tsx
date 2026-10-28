import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo } from 'react';
import { layoutStore, useLayoutStore } from '@/stores/layout';
import { useSchemaStore } from '@/stores/schema';
import {
  CompactNode,
  isCompactZoom,
  type CompactNodeType,
} from './CompactNode';
import { foreignKeyEdges } from './edges';
import { FkEdge, FkMarkers } from './FkEdge';
import { tableViews, unionOf } from './model-view';
import { TableNode, type TableNodeType } from './TableNode';
import { useAutoLayout } from './use-auto-layout';

// outside the component: React Flow wants the same object on every render
const nodeTypes = { table: TableNode, compact: CompactNode };
const edgeTypes = { fk: FkEdge };

/** Where a table goes until the layout has placed it: a grid, in the order the tables are listed. */
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
  return (
    <ReactFlowProvider>
      <CanvasContent />
    </ReactFlowProvider>
  );
}

function CanvasContent() {
  const { fitView } = useReactFlow();
  // true or false, so the canvas redraws when the tables change form, not while zooming
  const compact = useStore((s) => isCompactZoom(s.transform[2]));
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const model = useMemo(() => unionOf(baseline, desired), [baseline, desired]);
  const views = useMemo(() => tableViews(model), [model]);
  const status = useAutoLayout(model, views);
  const positions = useLayoutStore((s) => s.positions);
  const nodes = useMemo<(TableNodeType | CompactNodeType)[]>(
    () =>
      views.map((view, i) => ({
        id: view.id,
        type: compact ? 'compact' : 'table',
        position: positions[view.id] ?? gridPosition(i),
        data: view,
      })),
    [views, positions, compact],
  );
  // a dragged table tells the layout store where it is, which saves it a moment later
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes)
      if (change.type === 'position' && change.position)
        layoutStore.getState().move(change.id, change.position);
  }, []);
  // a table seen from far away is zoomed to before anything is done with it
  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === 'compact')
        void fitView({ nodes: [{ id: node.id }], maxZoom: 1, duration: 300 });
    },
    [fitView],
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
        nodesDraggable
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
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
