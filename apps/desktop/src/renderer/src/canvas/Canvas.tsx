import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeMouseHandler,
  type NodeChange,
  type OnConnectStart,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { FkPopover } from '@/editors/FkPopover';
import { layoutStore, useLayoutStore } from '@/stores/layout';
import { useDerived } from '@/stores/derived';
import { useSchemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';
import {
  CompactNode,
  isCompactZoom,
  type CompactNodeType,
} from './CompactNode';
import { connectColumns, columnOfHandle } from './connect';
import { foreignKeyEdges, foreignKeyStubs, type StubNodeType } from './edges';
import { FkEdge, FkMarkers } from './FkEdge';
import { tableViews, unionOf } from './model-view';
import { createTableAt } from './new-table';
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
  const { fitView, screenToFlowPosition } = useReactFlow();
  // true or false, so the canvas redraws when the tables change form, not while zooming
  const compact = useStore((s) => isCompactZoom(s.transform[2]));
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const model = useMemo(() => unionOf(baseline, desired), [baseline, desired]);
  const { statuses, errors, named } = useDerived();
  const views = useMemo(
    () => tableViews(model, { statuses, errors, named }),
    [model, statuses, errors, named],
  );
  const status = useAutoLayout(model, views);
  const positions = useLayoutStore((s) => s.positions);
  const removedKeys = useMemo(
    () =>
      new Set(
        Object.entries(statuses)
          .filter(([, s]) => s.status === 'removed')
          .map(([id]) => id),
      ),
    [statuses],
  );
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
      edges: [
        ...foreignKeyEdges(model, positions, visible, removedKeys),
        ...stubs.edges,
      ],
    };
  }, [tableNodes, model, positions, removedKeys]);
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
  // a click on a foreign key line opens what can be done to it, where it was clicked
  const [fkAnchor, setFkAnchor] = useState({ x: 0, y: 0 });
  const onEdgeClick = useCallback<EdgeMouseHandler>((event, edge) => {
    if (edge.id.startsWith('stub:')) return;
    setFkAnchor({ x: event.clientX, y: event.clientY });
    uiStore.getState().startEditing(`${edge.id}:fk`);
  }, []);
  // A line is dragged from the handle where it starts to the one where it ends. Which of the two
  // ends React Flow calls the source depends on the kind of handle it was started from, so the
  // column it was started from is kept, and that is the one that gets the key.
  const dragStart = useRef<string | null>(null);
  const onConnectStart = useCallback<OnConnectStart>((_, { handleId }) => {
    dragStart.current = columnOfHandle(handleId);
  }, []);
  const onConnect = useCallback((connection: Connection) => {
    const ends = [
      columnOfHandle(connection.sourceHandle),
      columnOfHandle(connection.targetHandle),
    ];
    const from = dragStart.current ?? ends[0];
    const to = ends[0] === from ? ends[1] : ends[0];
    if (from && to) connectColumns(from, to);
  }, []);
  // a new table where the empty canvas was double-clicked
  const onDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (compact || !target.classList.contains('react-flow__pane')) return;
      createTableAt(
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [compact, screenToFlowPosition],
  );
  return (
    <div data-layout={status} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // a line from any handle to any other: which side or end it starts at is worked out afterwards
        nodesConnectable
        connectionMode={ConnectionMode.Loose}
        onConnectStart={onConnectStart}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        nodesDraggable
        // a table is deleted from its toolbar; the key must never do it, least of all while typing
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        onDoubleClick={onDoubleClick}
        // a popover left open is closed by a click on the empty canvas
        onPaneClick={() => uiStore.getState().cancelEditing()}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.1}
      >
        <FkMarkers />
        <FkPopover anchor={fkAnchor} />
        <FitWhenLaidOut laidOut={status === 'ready'} />
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
