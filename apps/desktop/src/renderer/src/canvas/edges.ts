import type { Edge, Node } from '@xyflow/react';
import type { Constraint, Id, SchemaModel } from '@pgsketch/core';
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  PADDING,
  ROW_HEIGHT,
} from '@/layout/autoLayout';

export type FkEdgeData = {
  selfReference: boolean;
  /** The change drops this foreign key. */
  removed: boolean;
};
export type FkEdgeType = Edge<FkEdgeData, 'fk'>;

/** The id of one of the four handles of a column row: which side it is on, and what it connects as. */
export const handleId = (
  columnId: Id,
  side: 'left' | 'right',
  role: 'source' | 'target',
): string => `${columnId}:${side}-${role}`;

type ForeignKey = Extract<Constraint, { kind: 'fk' }>;

/** A foreign key with the first pair of its columns, or nothing when a table or column of it isn't in the model. */
function endsOf(
  model: SchemaModel,
  key: Constraint,
): { key: ForeignKey; from: Id; to: Id } | null {
  if (key.kind !== 'fk') return null;
  const from = key.columnIds[0];
  const to = key.refColumnIds[0];
  if (
    from === undefined ||
    to === undefined ||
    !model.columns[from] ||
    !model.columns[to] ||
    !model.tables[key.tableId] ||
    !model.tables[key.refTableId]
  )
    return null;
  return { key, from, to };
}

const isVisible = (visible: ReadonlySet<Id> | undefined, id: Id): boolean =>
  visible === undefined || visible.has(id);

/**
 * One edge for each foreign key between tables that are drawn (all of them, unless `visible` says
 * which are), from the column it starts at to the one it points at (the first pair of a composite
 * key). The line leaves the side of the table that faces the other table, and a foreign key to its
 * own table leaves and returns on the right, which draws as a loop.
 */
export function foreignKeyEdges(
  model: SchemaModel,
  positions: Record<Id, { x: number }>,
  visible?: ReadonlySet<Id>,
  removed: ReadonlySet<Id> = new Set(),
): FkEdgeType[] {
  return Object.values(model.constraints).flatMap((constraint) => {
    const ends = endsOf(model, constraint);
    if (
      !ends ||
      !isVisible(visible, ends.key.tableId) ||
      !isVisible(visible, ends.key.refTableId)
    )
      return [];
    const { key, from, to } = ends;
    const selfReference = key.tableId === key.refTableId;
    const forward =
      selfReference ||
      (positions[key.tableId]?.x ?? 0) <= (positions[key.refTableId]?.x ?? 0);
    return [
      {
        id: key.id,
        type: 'fk' as const,
        source: key.tableId,
        target: key.refTableId,
        sourceHandle: handleId(from, forward ? 'right' : 'left', 'source'),
        targetHandle: handleId(
          to,
          selfReference ? 'right' : forward ? 'left' : 'right',
          'target',
        ),
        data: { selfReference, removed: removed.has(key.id) },
      },
    ];
  });
}

export type StubNodeType = Node<{ label: string }, 'stub'>;

/** The one handle of a stub, which the line to it ends at. */
export const STUB_HANDLE = 'in';
export const STUB_WIDTH = 170;
export const STUB_HEIGHT = 24;
/** How far to the right of its table a stub is. */
const STUB_GAP = 60;

/**
 * For a foreign key from a drawn table to one that isn't (its schema is hidden): a small node
 * beside the key's row, named for the table it points at, and the line to it. A key the other way
 * round, from a hidden table to a drawn one, has no line: its table isn't there to start it.
 */
export function foreignKeyStubs(
  model: SchemaModel,
  placed: Record<Id, { x: number; y: number }>,
  visible: ReadonlySet<Id>,
): { nodes: StubNodeType[]; edges: FkEdgeType[] } {
  const nodes: StubNodeType[] = [];
  const edges: FkEdgeType[] = [];
  for (const constraint of Object.values(model.constraints)) {
    const ends = endsOf(model, constraint);
    if (
      !ends ||
      !visible.has(ends.key.tableId) ||
      visible.has(ends.key.refTableId)
    )
      continue;
    const { key, from } = ends;
    const target = model.tables[key.refTableId]!;
    const row = Object.values(model.columns)
      .filter((c) => c.tableId === key.tableId)
      .sort((a, b) => a.position - b.position)
      .findIndex((c) => c.id === from);
    const table = placed[key.tableId] ?? { x: 0, y: 0 };
    const id = `stub:${key.id}`;
    nodes.push({
      id,
      type: 'stub',
      position: {
        x: table.x + NODE_WIDTH + STUB_GAP,
        y:
          table.y +
          HEADER_HEIGHT +
          PADDING / 2 +
          row * ROW_HEIGHT +
          (ROW_HEIGHT - STUB_HEIGHT) / 2,
      },
      data: {
        label: `${model.schemas[target.schemaId]?.name ?? ''}.${target.name}`,
      },
      draggable: false,
      selectable: false,
      focusable: false,
    });
    edges.push({
      id,
      type: 'fk',
      source: key.tableId,
      target: id,
      sourceHandle: handleId(from, 'right', 'source'),
      targetHandle: STUB_HANDLE,
      data: { selfReference: false, removed: false },
    });
  }
  return { nodes, edges };
}

/** How far out from the table a self-reference swings. */
const LOOP_REACH = 60;

/**
 * The path of a foreign key from a table to itself: both ends are on the right side, so it leaves
 * to the right, swings out and comes back. (An ordinary curve between two points at the same x
 * has no bulge, and would run along the table's edge.)
 */
export const loopPath = (
  source: { x: number; y: number },
  target: { x: number; y: number },
): string =>
  `M ${source.x},${source.y} C ${source.x + LOOP_REACH},${source.y} ${target.x + LOOP_REACH},${target.y} ${target.x},${target.y}`;
