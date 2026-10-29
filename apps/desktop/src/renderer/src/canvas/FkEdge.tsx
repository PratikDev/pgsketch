import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { loopPath, type FkEdgeType } from './edges';

const CROW_FOOT = 'pgsketch-crow-foot';
const ONE = 'pgsketch-one';

/**
 * The end markers of a foreign key line, drawn once for all of them: a crow's foot where the line
 * starts (the table with the key: many rows may point at one) and a bar where it ends (the row it
 * points at: one).
 */
export function FkMarkers() {
  const stroke = { stroke: 'var(--muted-foreground)', fill: 'none' };
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0 }}
    >
      <defs>
        <marker
          id={CROW_FOOT}
          viewBox="0 0 12 12"
          refX={0}
          refY={6}
          markerWidth={12}
          markerHeight={12}
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M12 6 L0 0 M12 6 L0 6 M12 6 L0 12" style={stroke} />
        </marker>
        <marker
          id={ONE}
          viewBox="0 0 12 12"
          refX={12}
          refY={6}
          markerWidth={12}
          markerHeight={12}
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M8 1 L8 11 M11 1 L11 11" style={stroke} />
        </marker>
      </defs>
    </svg>
  );
}

/** A foreign key between two columns; to its own table it curves out from the right side and back. */
export function FkEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<FkEdgeType>) {
  const selfReference = data?.selfReference === true;
  const [curve] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const path = selfReference
    ? loopPath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY })
    : curve;
  const removed = data?.removed === true;
  return (
    <g data-self-reference={selfReference} data-removed={removed}>
      <BaseEdge
        path={path}
        // a key the change drops: red, dashed and faded, like a removed row
        style={
          removed
            ? {
                stroke: 'var(--destructive)',
                strokeDasharray: '6 4',
                opacity: 0.6,
              }
            : undefined
        }
        markerStart={`url(#${CROW_FOOT})`}
        markerEnd={`url(#${ONE})`}
      />
    </g>
  );
}
