import { render, screen, within } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { describe, expect, test } from 'vitest';
import {
  HEADER_HEIGHT,
  NODE_WIDTH,
  nodeHeight,
  ROW_HEIGHT,
} from '@/layout/autoLayout';
import { fixtureModel } from '@/test-model';
import { tableViews } from './model-view';
import { TableNode, type TableNodeType } from './TableNode';

const props = (name: string): NodeProps<TableNodeType> => {
  const data = tableViews(fixtureModel).find((t) => t.name === name)!;
  // only `data` is read; the rest is what React Flow would pass
  return { data } as NodeProps<TableNodeType>;
};

describe('TableNode', () => {
  test('names the table with its schema, over one row per column', () => {
    render(
      <ReactFlowProvider>
        <TableNode {...props('invoices')} />
      </ReactFlowProvider>,
    );
    const table = screen.getByRole('region', { name: 'billing.invoices' });
    expect(within(table).getByRole('banner')).toHaveTextContent(
      'billing.invoices',
    );
    expect(
      within(table)
        .getAllByRole('listitem')
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringContaining('id'),
      expect.stringContaining('user_id'),
      expect.stringContaining('total'),
    ]);
  });

  test('shows the badges, default chips and foreign key targets of its columns', () => {
    render(
      <ReactFlowProvider>
        <TableNode {...props('invoices')} />
      </ReactFlowProvider>,
    );
    expect(screen.getByTitle(/^Foreign key/)).toHaveTextContent(
      '→ public.users.id',
    );
    expect(screen.getAllByTitle(/^Default/).map((e) => e.textContent)).toEqual([
      "= nextval('billing.invoices_id_seq'::regclass)",
      '= 0',
    ]);
    expect(screen.getAllByText('NN').length).toBeGreaterThan(0);
  });

  test('shows the primary key of a table that has one', () => {
    render(
      <ReactFlowProvider>
        <TableNode {...props('users')} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText('PK')).toBeInTheDocument();
    expect(screen.getByTitle(/^Default/)).toHaveTextContent(
      "= 'active'::user_status",
    );
  });

  test('is drawn at the size the layout leaves room for', () => {
    render(
      <ReactFlowProvider>
        <TableNode {...props('invoices')} />
      </ReactFlowProvider>,
    );
    const table = screen.getByRole('region', { name: 'billing.invoices' });
    expect(table.style.width).toBe(`${NODE_WIDTH}px`);
    const header = within(table).getByRole('banner');
    const rows = within(table).getAllByRole('listitem');
    expect(header.style.height).toBe(`${HEADER_HEIGHT}px`);
    for (const row of rows) expect(row.style.height).toBe(`${ROW_HEIGHT}px`);
    // header, rows and the padding around them add up to the height the layout assumes
    const padding =
      Number.parseFloat(rows[0]!.parentElement!.style.padding) * 2;
    expect(HEADER_HEIGHT + rows.length * ROW_HEIGHT + padding).toBe(
      nodeHeight(rows.length),
    );
  });
});
