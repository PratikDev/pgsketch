import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import {
  autoLayout,
  NODE_WIDTH,
  nodeHeight,
  toElkGraph,
  type LayoutLink,
  type LayoutRunner,
  type LayoutTable,
} from './autoLayout';

const elk = new ELK();
/** The real layout, run in this thread instead of a worker. */
const run: LayoutRunner = (graph) => elk.layout(graph);

const table = (id: string, columns = 3): LayoutTable => ({
  id,
  columnIds: Array.from({ length: columns }, (_, i) => `${id}.c${i}`),
});
const link = (
  id: string,
  from: string,
  fromColumn: number,
  to: string,
  toColumn: number,
): LayoutLink => ({
  id,
  fromTable: from,
  fromColumn: `${from}.c${fromColumn}`,
  toTable: to,
  toColumn: `${to}.c${toColumn}`,
});

const overlap = (
  a: { x: number; y: number; h: number },
  b: { x: number; y: number; h: number },
) =>
  a.x < b.x + NODE_WIDTH &&
  b.x < a.x + NODE_WIDTH &&
  a.y < b.y + b.h &&
  b.y < a.y + a.h;

describe('toElkGraph', () => {
  const graph = toElkGraph(
    [table('a', 4), table('b')],
    [link('k', 'a', 2, 'b', 0)],
  );

  test('has a node for each table, as big as it will be drawn', () => {
    expect(graph.children?.map((c) => [c.id, c.width, c.height])).toEqual([
      ['a', NODE_WIDTH, nodeHeight(4)],
      ['b', NODE_WIDTH, nodeHeight(3)],
    ]);
  });

  test('has a port on the row of each end of a foreign key: east where it starts, west where it ends', () => {
    const [a, b] = graph.children!;
    expect(a!.ports).toEqual([
      expect.objectContaining({
        id: 'k:from',
        x: NODE_WIDTH,
        layoutOptions: { 'elk.port.side': 'EAST' },
      }),
    ]);
    expect(b!.ports).toEqual([
      expect.objectContaining({
        id: 'k:to',
        x: 0,
        layoutOptions: { 'elk.port.side': 'WEST' },
      }),
    ]);
    // the port of the third row is lower than the port of the first
    const rowY = (port: { y?: number } | undefined) => port?.y ?? 0;
    const third = toElkGraph([table('a', 4)], [link('x', 'a', 2, 'a', 0)])
      .children![0]!.ports!;
    expect(rowY(third[0])).toBeGreaterThan(rowY(third[1]));
  });

  test('has an edge between those ports', () => {
    expect(graph.edges).toEqual([
      { id: 'k', sources: ['k:from'], targets: ['k:to'] },
    ]);
  });
});

describe('autoLayout', () => {
  const tables = [
    table('users', 5),
    table('invoices', 4),
    table('items', 3),
    table('audit', 2),
    table('tags', 2),
  ];
  const links = [
    link('k1', 'invoices', 1, 'users', 0),
    link('k2', 'items', 1, 'invoices', 0),
  ];

  test('gives every table a position', async () => {
    const positions = await autoLayout(tables, links, run);
    expect(Object.keys(positions).sort()).toEqual([
      'audit',
      'invoices',
      'items',
      'tags',
      'users',
    ]);
    for (const p of Object.values(positions))
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  test('no two tables overlap', async () => {
    const positions = await autoLayout(tables, links, run);
    const boxes = tables.map((t) => ({
      ...positions[t.id]!,
      h: nodeHeight(t.columnIds.length),
    }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(
          overlap(boxes[i]!, boxes[j]!),
          `${tables[i]!.id} and ${tables[j]!.id}`,
        ).toBe(false);
  });

  test('puts a table to the left of the table its foreign key points at', async () => {
    const p = await autoLayout(tables, links, run);
    expect(p.items!.x).toBeLessThan(p.invoices!.x);
    expect(p.invoices!.x).toBeLessThan(p.users!.x);
  });

  test('copes with a table that points at itself, and with two keys between the same tables', async () => {
    const positions = await autoLayout(
      [table('users', 3), table('invoices', 3)],
      [
        link('self', 'users', 2, 'users', 0),
        link('a', 'invoices', 1, 'users', 0),
        link('b', 'invoices', 2, 'users', 0),
      ],
      run,
    );
    expect(Object.keys(positions).sort()).toEqual(['invoices', 'users']);
  });

  test('no tables is no positions, and the layout is not asked', async () => {
    let asked = false;
    expect(await autoLayout([], [], async (g) => ((asked = true), g))).toEqual(
      {},
    );
    expect(asked).toBe(false);
  });

  test('the same schema gives the same layout', async () => {
    expect(await autoLayout(tables, links, run)).toEqual(
      await autoLayout(tables, links, run),
    );
  });

  test('tables with nothing between them are still apart', async () => {
    const p = await autoLayout([table('a'), table('b'), table('c')], [], run);
    const places = new Set(Object.values(p).map((q) => `${q.x},${q.y}`));
    expect(places.size).toBe(3);
  });
});
