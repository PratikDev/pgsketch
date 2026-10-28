import { render, screen, within } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import { describe, expect, test } from 'vitest';
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
    render(<TableNode {...props('invoices')} />);
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
    render(<TableNode {...props('invoices')} />);
    expect(screen.getByTitle('Foreign key')).toHaveTextContent(
      '→ public.users.id',
    );
    expect(screen.getAllByTitle('Default').map((e) => e.textContent)).toEqual([
      "= nextval('billing.invoices_id_seq'::regclass)",
      '= 0',
    ]);
    expect(screen.getAllByText('NN').length).toBeGreaterThan(0);
  });

  test('shows the primary key of a table that has one', () => {
    render(<TableNode {...props('users')} />);
    expect(screen.getByText('PK')).toBeInTheDocument();
    expect(screen.getByTitle('Default')).toHaveTextContent(
      "= 'active'::user_status",
    );
  });
});
