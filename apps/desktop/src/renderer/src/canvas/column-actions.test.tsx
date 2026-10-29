import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useDerived } from '@/stores/derived';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { tableViews, unionOf } from './model-view';
import { TableNode, type TableNodeType } from './TableNode';

const casts = { categories: {}, domains: {}, casts: {} };
beforeEach(() =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  ),
);
afterEach(() =>
  act(() =>
    uiStore.setState({ editing: null, addedColumn: null, notice: null }),
  ),
);

/** A table drawn from the store, as the canvas draws it. */
function Live({ tableId }: { tableId: string }) {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const { statuses, errors } = useDerived();
  const data = tableViews(unionOf(baseline, desired), {
    statuses,
    errors,
  }).find((t) => t.id === tableId)!;
  return (
    <ReactFlowProvider>
      <TableNode {...({ data } as NodeProps<TableNodeType>)} />
    </ReactFlowProvider>
  );
}
const columnsOf = (tableId: string) =>
  Object.values(schemaStore.getState().desired.columns)
    .filter((c) => c.tableId === tableId)
    .map((c) => c.name);
const rowOf = (name: string) =>
  screen
    .getAllByRole('listitem')
    .find((li) => li.textContent?.startsWith(name))!;

// t:20 is billing.invoices: id, user_id, total
describe('adding columns with the keyboard', () => {
  test('Enter on the last column goes on to a new column with its name ready, and typing names it', async () => {
    render(<Live tableId="t:20" />);
    await userEvent.click(
      within(rowOf('total')).getByRole('button', {
        name: 'total',
      }),
    );
    await userEvent.keyboard('{Enter}');
    expect(columnsOf('t:20')).toEqual(['id', 'user_id', 'total', 'new_column']);
    expect(screen.getByRole('textbox', { name: 'Column name' })).toHaveFocus();
    await userEvent.keyboard('first{Enter}');
    await userEvent.keyboard('second{Enter}');
    expect(columnsOf('t:20')).toEqual([
      'id',
      'user_id',
      'total',
      'first',
      'second',
      'new_column',
    ]);
  });

  test('Esc on a column that was just made takes it away again', async () => {
    render(<Live tableId="t:20" />);
    await userEvent.click(
      within(rowOf('total')).getByRole('button', {
        name: 'total',
      }),
    );
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('first{Enter}{Escape}');
    expect(columnsOf('t:20')).toEqual(['id', 'user_id', 'total', 'first']);
  });

  test('Esc on a column that exists, or that was named, leaves it', async () => {
    render(<Live tableId="t:20" />);
    await userEvent.click(
      within(rowOf('total')).getByRole('button', {
        name: 'total',
      }),
    );
    await userEvent.keyboard('{Escape}');
    expect(columnsOf('t:20')).toEqual(['id', 'user_id', 'total']);
    await userEvent.keyboard('{Enter}'); // focus is back on the name: Enter opens it
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('x{Tab}');
    const added = columnsOf('t:20');
    expect(added).toEqual(['id', 'user_id', 'total', 'x']);
  });

  test('Enter on a column that is not the last does not add one', async () => {
    render(<Live tableId="t:20" />);
    await userEvent.click(
      within(rowOf('user_id')).getByRole('button', {
        name: 'user_id',
      }),
    );
    await userEvent.keyboard('{Enter}');
    expect(columnsOf('t:20')).toHaveLength(3);
  });

  test('Tab commits the name and goes on to the type of the same row', async () => {
    render(<Live tableId="t:20" />);
    await userEvent.click(
      within(rowOf('user_id')).getByRole('button', {
        name: 'user_id',
      }),
    );
    await userEvent.keyboard('owner{Tab}');
    expect(columnsOf('t:20')).toContain('owner');
    expect(
      within(rowOf('owner')).getByRole('button', { name: 'Column type' }),
    ).toHaveFocus();
  });
});

describe('deleting a column', () => {
  const menu = async (name: string) => {
    await userEvent.click(
      within(rowOf(name)).getByRole('button', { name: 'Column actions' }),
    );
  };

  test('removes the column from the model and leaves it struck through to restore', async () => {
    render(<Live tableId="t:20" />);
    await menu('user_id');
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Delete column' }),
    );
    expect(columnsOf('t:20')).toEqual(['id', 'total']);
    expect(rowOf('user_id')).toHaveAttribute('data-status', 'removed');
    await menu('user_id');
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Restore column' }),
    );
    expect(columnsOf('t:20')).toContain('user_id');
    expect(rowOf('user_id')).not.toHaveAttribute('data-status');
  });

  test('a column something depends on is not removed, and the reason is shown', async () => {
    render(<Live tableId="t:20" />);
    await menu('total'); // the view open_invoices uses it
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Delete column' }),
    );
    expect(columnsOf('t:20')).toContain('total');
    expect(uiStore.getState().notice).toBe(
      'Can\'t delete column "total": view "open_invoices" still depends on it',
    );
  });

  test('a read-only column has no menu', () => {
    render(<Live tableId="t:20" />);
    expect(
      within(rowOf('id')).queryByRole('button', { name: 'Column actions' }),
    ).not.toBeInTheDocument();
  });
});

describe('restoring by a click', () => {
  test('a click on a removed column brings it back, and a click on a plain one does nothing', async () => {
    render(<Live tableId="t:20" />);
    await userEvent.click(rowOf('user_id'));
    expect(columnsOf('t:20')).toEqual(['id', 'user_id', 'total']);
    act(() => void schemaStore.getState().removeColumn('c:20:2'));
    expect(rowOf('user_id')).toHaveAttribute('data-status', 'removed');
    expect(rowOf('user_id')).toHaveAttribute(
      'title',
      expect.stringContaining('click to restore'),
    );
    await userEvent.click(rowOf('user_id'));
    expect(columnsOf('t:20')).toContain('user_id');
    expect(rowOf('user_id')).not.toHaveAttribute('data-status');
  });

  test('the row of a column of a removed table brings the whole table back', async () => {
    render(<Live tableId="t:10" />);
    act(() => void schemaStore.getState().removeTable('t:10'));
    expect(schemaStore.getState().desired.tables['t:10']).toBeUndefined();
    await userEvent.click(rowOf('status'));
    expect(schemaStore.getState().desired.tables['t:10']).toBeDefined();
    expect(columnsOf('t:10')).toEqual(['id', 'status']);
  });

  test('a click on the header of a removed table brings it back', async () => {
    render(<Live tableId="t:10" />);
    act(() => void schemaStore.getState().removeTable('t:10'));
    await userEvent.click(screen.getByRole('banner'));
    expect(schemaStore.getState().desired.tables['t:10']).toBeDefined();
  });
});
