import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { tableViews } from './model-view';
import { TableToolbar } from './TableToolbar';

// the toolbar is drawn next to a measured node, which jsdom has none of
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  NodeToolbar: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

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

const table = (id: string, removed = false) => {
  const view = tableViews(fixtureModel).find((t) => t.id === id)!;
  if (removed)
    view.state = { ...view.state, status: { status: 'removed', old: {} } };
  return view;
};
const columnsOf = (id: string) =>
  Object.values(schemaStore.getState().desired.columns).filter(
    (c) => c.tableId === id,
  );

describe('TableToolbar', () => {
  test('adds a column and opens its name', async () => {
    render(<TableToolbar table={table('t:10')} visible />);
    await userEvent.click(screen.getByRole('button', { name: 'Add column' }));
    expect(columnsOf('t:10')).toHaveLength(3);
    expect(uiStore.getState().editing).toMatch(/:name$/);
  });

  test('deletes a table, and the foreign keys to it go too', async () => {
    render(<TableToolbar table={table('t:10')} visible />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    expect(schemaStore.getState().desired.tables['t:10']).toBeUndefined();
    expect(schemaStore.getState().desired.constraints['k:2']).toBeUndefined();
  });

  test('a table something depends on is not deleted, and the reason is shown', async () => {
    render(<TableToolbar table={table('t:20')} visible />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    expect(schemaStore.getState().desired.tables['t:20']).toBeDefined();
    expect(uiStore.getState().notice).toMatch(/Can't delete table "invoices"/);
  });

  test('a removed table has only a restore button, which brings it back', async () => {
    act(() => void schemaStore.getState().removeTable('t:10'));
    render(<TableToolbar table={table('t:10', true)} visible />);
    expect(
      screen.queryByRole('button', { name: 'Add column' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Restore table' }),
    );
    expect(schemaStore.getState().desired.tables['t:10']).toBeDefined();
  });

  test('a read-only table has no toolbar', () => {
    const view = table('t:10');
    view.state = { ...view.state, readOnly: 'partitioned-table' };
    render(<TableToolbar table={view} visible />);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});
