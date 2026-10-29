import { render } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import { describe, expect, test } from 'vitest';
import type { FkEdgeData, FkEdgeType } from './edges';
import { FkEdge } from './FkEdge';

const draw = (data: FkEdgeData) => {
  const props = {
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 50,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data,
  } as EdgeProps<FkEdgeType>;
  const { container } = render(
    <svg>
      <FkEdge {...props} />
    </svg>,
  );
  return {
    group: container.querySelector('g')!,
    path: container.querySelector(
      'path.react-flow__edge-path',
    ) as SVGPathElement,
  };
};

describe('FkEdge', () => {
  test('is an ordinary line for a key that stays', () => {
    const { group, path } = draw({ selfReference: false, removed: false });
    expect(group).toHaveAttribute('data-removed', 'false');
    expect(path.style.strokeDasharray).toBe('');
    expect(path.style.opacity).toBe('');
  });

  test('is red, dashed and faded for a key the change drops', () => {
    const { group, path } = draw({ selfReference: false, removed: true });
    expect(group).toHaveAttribute('data-removed', 'true');
    expect(path.style.stroke).toBe('var(--destructive)');
    expect(path.style.strokeDasharray).toBe('6 4');
    expect(path.style.opacity).toBe('0.6');
  });
});
