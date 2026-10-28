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
import { useDerived } from '@/stores/derived';
import { useSchemaStore } from '@/stores/schema';
import { useUiStore } from '@/stores/ui';
import {
  CompactNode,
  isCompactZoom,
  type CompactNodeType,
} from './CompactNode';
import { foreignKeyEdges, foreignKeyStubs, type StubNodeType } from './edges';
import { FkEdge, FkMarkers } from './FkEdge';
import { tableViews, unionOf } from './model-view';
import { StubNode } from './StubNode';
import { TableNode, type TableNodeType } from './TableNode';
import { useAutoLayout } from './use-auto-layout';

// outside the component: React Flow wants the same object on every render
const nodeTypes = { table: TableNode, compact: CompactNode, stub: StubNode };
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
  const { statuses, errors } = useDerived();
  const views = useMemo(
    () => tableViews(model, { statuses, errors }),
    [model, statuses, errors],
  );
  const status = useAutoLayout(model, views);
  const positions = useLayoutStore((s) => s.positions);
  const hiddenSchemas = useUiStore((s) => s.hiddenSchemas);
  // tables of a hidden schema stay laid out and positioned, they are just not drawn
  const tableNodes = useMemo<(TableNodeType | CompactNodeType)[]>(
    () =>
      views.flatMap((view, i) =>
        hiddenSchemas.includes(model.tables[view.id]?.schemaId ?? '')
          ? []
          : [
              {
                id: view.id,
                type: compact ? ('compact' as const) : ('table' as const),
                position: positions[view.id] ?? gridPosition(i),
                data: view,
              },
            ],
      ),
    [views, model, hiddenSchemas, positions, compact],
  );
  const { nodes, edges } = useMemo(() => {
    const visible = new Set(tableNodes.map((n) => n.id));
    const placed = Object.fromEntries(
      tableNodes.map((n) => [n.id, n.position]),
    );
    const stubs = foreignKeyStubs(model, placed, visible);
    return {
      nodes: [...tableNodes, ...stubs.nodes] as (
        TableNodeType | CompactNodeType | StubNodeType
      )[],
      edges: [...foreignKeyEdges(model, positions, visible), ...stubs.edges],
    };
  }, [tableNodes, model, positions]);
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
  return (
    <div data-layout={status} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable
        // a table is deleted from its toolbar; the key must never do it, least of all while typing
        deleteKeyCode={null}
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
