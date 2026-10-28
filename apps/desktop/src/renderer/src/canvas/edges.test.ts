import type { SchemaModel } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { foreignKeyEdges, handleId, loopPath } from './edges';

const withKeys = (change: (m: SchemaModel) => void): SchemaModel => {
  const model = structuredClone(fixtureModel);
  change(model);
  return model;
};

const selfKey = {
  id: 'k:self',
  tableId: 't:10',
  kind: 'fk' as const,
  name: 'users_self_fkey',
  columnIds: ['c:10:2'],
  refTableId: 't:10',
  refColumnIds: ['c:10:1'],
  onDelete: 'no action' as const,
  onUpdate: 'no action' as const,
};

describe('foreignKeyEdges', () => {
  test('is one edge for each foreign key, between the tables it joins', () => {
    const edges = foreignKeyEdges(fixtureModel, {});
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: 'k:2',
      type: 'fk',
      source: 't:20',
      target: 't:10',
      data: { selfReference: false },
    });
  });

  test('has none for a schema with no foreign keys', () => {
    expect(
      foreignKeyEdges(
        withKeys((m) => delete m.constraints['k:2']),
        {},
      ),
    ).toEqual([]);
  });

  test('leaves the side of the table that faces the other one', () => {
    const [left] = foreignKeyEdges(fixtureModel, {
      't:20': { x: 0 },
      't:10': { x: 500 },
    });
    expect(left).toMatchObject({
      sourceHandle: handleId('c:20:2', 'right', 'source'),
      targetHandle: handleId('c:10:1', 'left', 'target'),
    });
    const [right] = foreignKeyEdges(fixtureModel, {
      't:20': { x: 800 },
      't:10': { x: 0 },
    });
    expect(right).toMatchObject({
      sourceHandle: handleId('c:20:2', 'left', 'source'),
      targetHandle: handleId('c:10:1', 'right', 'target'),
    });
  });

  test('a foreign key to its own table leaves and returns on the right, as a loop', () => {
    const edges = foreignKeyEdges(
      withKeys((m) => (m.constraints['k:self'] = selfKey)),
      {},
    );
    const loop = edges.find((e) => e.id === 'k:self')!;
    expect(loop.data).toEqual({ selfReference: true });
    expect(loop.source).toBe(loop.target);
    expect(loop.sourceHandle).toBe(handleId('c:10:2', 'right', 'source'));
    expect(loop.targetHandle).toBe(handleId('c:10:1', 'right', 'target'));
    expect(edges).toHaveLength(2);
  });

  test('a composite key is one edge, from the first pair of columns', () => {
    const edges = foreignKeyEdges(
      withKeys((m) => {
        const key = m.constraints['k:2'];
        if (key?.kind === 'fk') {
          key.columnIds = ['c:20:2', 'c:20:3'];
          key.refColumnIds = ['c:10:1', 'c:10:2'];
        }
      }),
      {},
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.sourceHandle).toContain('c:20:2');
    expect(edges[0]!.targetHandle).toContain('c:10:1');
  });

  test('skips a key whose table or column is not in the model', () => {
    expect(
      foreignKeyEdges(
        withKeys((m) => delete m.tables['t:10']),
        {},
      ),
    ).toEqual([]);
    expect(
      foreignKeyEdges(
        withKeys((m) => delete m.columns['c:10:1']),
        {},
      ),
    ).toEqual([]);
  });

  test('every handle id is different, so no two lines share an end', () => {
    const ids = (['left', 'right'] as const).flatMap((side) =>
      (['source', 'target'] as const).map((role) =>
        handleId('c:1', side, role),
      ),
    );
    expect(new Set(ids).size).toBe(4);
  });
});

describe('loopPath', () => {
  test('starts at the first end and finishes at the other, swinging out to the right of both', () => {
    const path = loopPath({ x: 300, y: 50 }, { x: 300, y: 130 });
    const numbers = [...path.matchAll(/-?\d+(\.\d+)?/g)].map((m) =>
      Number(m[0]),
    );
    expect(path.startsWith('M 300,50 C')).toBe(true);
    expect(numbers.slice(0, 2)).toEqual([300, 50]);
    expect(numbers.slice(-2)).toEqual([300, 130]);
    // the two control points are both further right than either end
    expect(numbers[2]).toBeGreaterThan(300);
    expect(numbers[4]).toBeGreaterThan(300);
  });
});
