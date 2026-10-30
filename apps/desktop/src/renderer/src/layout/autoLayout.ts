import ELK, { type ElkNode, type ElkPort } from 'elkjs/lib/elk-api';
import type { Id } from '@pgsketch/core';

export type Point = { x: number; y: number };

/**
 * The size of a table node. Nodes are drawn at exactly this width, with a header and rows of
 * these heights (long text is cut short), so the layout can leave room for them without having
 * to wait until they are on the page and measured.
 */
export const NODE_WIDTH = 360;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 28;
export const PADDING = 8;
export const nodeHeight = (columns: number): number =>
  HEADER_HEIGHT + columns * ROW_HEIGHT + PADDING;
const rowCenter = (index: number): number =>
  HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;

export interface LayoutTable {
  id: Id;
  /** The ids of its columns, in the order the rows are drawn. */
  columnIds: Id[];
}

/** A foreign key: from a column of the table that has it to a column of the table it points at. */
export interface LayoutLink {
  id: Id;
  fromTable: Id;
  fromColumn: Id;
  toTable: Id;
  toColumn: Id;
}

/** Runs the layout, wherever that is: in a worker in the app, in the same thread in a test. */
export type LayoutRunner = (graph: ElkNode) => Promise<ElkNode>;

/**
 * The graph ELK lays out: a node per table, and for each foreign key a port on the row of the
 * column it starts from (east side) and one on the row of the column it ends at (west side), so
 * the layout puts tables the way the lines between those rows would run.
 */
export function toElkGraph(
  tables: LayoutTable[],
  links: LayoutLink[],
): ElkNode {
  const rows = new Map(tables.map((t) => [t.id, t.columnIds]));
  const rowOf = (table: Id, column: Id) =>
    Math.max(0, rows.get(table)?.indexOf(column) ?? 0);
  const port = (
    link: LayoutLink,
    end: 'from' | 'to',
  ): { owner: Id; port: ElkPort } => {
    const table = end === 'from' ? link.fromTable : link.toTable;
    const column = end === 'from' ? link.fromColumn : link.toColumn;
    return {
      owner: table,
      port: {
        id: `${link.id}:${end}`,
        x: end === 'from' ? NODE_WIDTH : 0,
        y: rowCenter(rowOf(table, column)),
        width: 0,
        height: 0,
        layoutOptions: {
          'elk.port.side': end === 'from' ? 'EAST' : 'WEST',
        },
      },
    };
  };
  const ports = links.flatMap((l) => [port(l, 'from'), port(l, 'to')]);
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '140',
    },
    children: tables.map((t) => ({
      id: t.id,
      width: NODE_WIDTH,
      height: nodeHeight(t.columnIds.length),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: ports.filter((p) => p.owner === t.id).map((p) => p.port),
    })),
    edges: links.map((l) => ({
      id: l.id,
      sources: [`${l.id}:from`],
      targets: [`${l.id}:to`],
    })),
  };
}

let elk: InstanceType<typeof ELK> | undefined;

/** The layout engine runs in a worker (`elk.worker.ts`), started when it is first needed. */
const runInWorker: LayoutRunner = (graph) => {
  elk ??= new ELK({
    workerFactory: () =>
      new Worker(new URL('./elk.worker.ts', import.meta.url), {
        type: 'module',
      }),
  });
  return elk.layout(graph);
};

/** Where each table goes: a layered layout, foreign keys running left to right. */
export async function autoLayout(
  tables: LayoutTable[],
  links: LayoutLink[],
  run: LayoutRunner = runInWorker,
): Promise<Record<Id, Point>> {
  if (tables.length === 0) return {};
  const laidOut = await run(toElkGraph(tables, links));
  return Object.fromEntries(
    (laidOut.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
  );
}
