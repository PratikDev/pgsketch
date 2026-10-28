import type { Edge } from '@xyflow/react';
import type { Id, SchemaModel } from '@pgsketch/core';

export type FkEdgeData = { selfReference: boolean };
export type FkEdgeType = Edge<FkEdgeData, 'fk'>;

/** The id of one of the four handles of a column row: which side it is on, and what it connects as. */
export const handleId = (
  columnId: Id,
  side: 'left' | 'right',
  role: 'source' | 'target',
): string => `${columnId}:${side}-${role}`;

/**
 * One edge for each foreign key, from the column it starts at to the one it points at (the first
 * pair of a composite key). The line leaves the side of the table that faces the other table, and
 * a foreign key to its own table leaves and returns on the right, which draws as a loop.
 */
export function foreignKeyEdges(
  model: SchemaModel,
  positions: Record<Id, { x: number }>,
): FkEdgeType[] {
  return Object.values(model.constraints).flatMap((key): FkEdgeType[] => {
    if (key.kind !== 'fk') return [];
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
      return [];
    const selfReference = key.tableId === key.refTableId;
    const forward =
      selfReference ||
      (positions[key.tableId]?.x ?? 0) <= (positions[key.refTableId]?.x ?? 0);
    return [
      {
        id: key.id,
        type: 'fk',
        source: key.tableId,
        target: key.refTableId,
        sourceHandle: handleId(from, forward ? 'right' : 'left', 'source'),
        targetHandle: handleId(
          to,
          selfReference ? 'right' : forward ? 'left' : 'right',
          'target',
        ),
        data: { selfReference },
      },
    ];
  });
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
