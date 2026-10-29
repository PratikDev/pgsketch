import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import type { ObjectState } from './object-state';
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
    expect(
      screen.getAllByText('PK').filter((b) => b.ariaPressed === 'true'),
    ).toHaveLength(1);
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

  describe('status', () => {
    const withState = (state: Partial<ObjectState>) => {
      const p = props('invoices');
      p.data.state = { status: null, error: null, readOnly: null, ...state };
      render(
        <ReactFlowProvider>
          <TableNode {...p} />
        </ReactFlowProvider>,
      );
      return screen.getByRole('region', { name: 'billing.invoices' });
    };

    test('each status styles the table', () => {
      const classes = {
        added: 'border-l-added',
        modified: 'border-l-modified',
        removed: 'line-through',
      } as const;
      for (const status of ['added', 'modified', 'removed'] as const) {
        const table = withState({ status: { status, old: {} } });
        expect(table).toHaveAttribute('data-status', status);
        expect(table).toHaveClass(classes[status]);
        cleanup();
      }
    });

    test('an error outlines the table and says what is wrong on hover', () => {
      const table = withState({ error: 'Table "invoices" already exists' });
      expect(table).toHaveClass('outline-destructive');
      expect(table).toHaveAttribute('aria-invalid', 'true');
      expect(table).toHaveAttribute('title', 'Table "invoices" already exists');
    });

    test('a read-only table is grey with a lock and says why', () => {
      const table = withState({ readOnly: 'partitioned-table' });
      expect(table).toHaveClass('bg-muted');
      expect(
        within(within(table).getByRole('banner')).getByLabelText('Read-only'),
      ).toBeInTheDocument();
      expect(table).toHaveAttribute('title', 'Read-only: partitioned table');
    });
  });

  describe('the toolbar safety zone', () => {
    const zone = () =>
      document.querySelector('[data-slot="toolbar-safe-zone"]');

    test('is there while the table is hovered, covering the gap above it, and gone when the pointer leaves', async () => {
      render(
        <ReactFlowProvider>
          <TableNode {...props('invoices')} />
        </ReactFlowProvider>,
      );
      expect(zone()).toBeNull();
      const table = screen.getByRole('region', { name: 'billing.invoices' });
      await userEvent.hover(table);
      expect(zone()).toHaveClass('bottom-full', 'h-5', 'inset-x-0');
      // it sits outside the table box, as part of the node, so it takes the hover too
      expect(table.contains(zone())).toBe(false);
      await userEvent.hover(zone() as Element);
      expect(zone()).not.toBeNull();
      await userEvent.unhover(zone() as Element);
      expect(zone()).toBeNull();
    });

    test('is there while the table is selected', () => {
      render(
        <ReactFlowProvider>
          <TableNode {...{ ...props('invoices'), selected: true }} />
        </ReactFlowProvider>,
      );
      expect(zone()).not.toBeNull();
    });
  });
});
