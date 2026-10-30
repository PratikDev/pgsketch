import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useDerived } from '@/stores/derived';
import { clearNormalizeCache } from '@/editors/ExpressionInput/normalize-cache';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { installFakeApi } from '@/test-utils';
import { tableViews, unionOf } from './model-view';
import { NodeFooter } from './NodeFooter';

// toasts are drawn by the Toaster, which these tests don't mount
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

const casts = { categories: {}, domains: {}, casts: {} };
beforeEach(() => {
  clearNormalizeCache();
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  );
});
afterEach(() =>
  act(() => {
    uiStore.getState().cancelEditing();
    uiStore.setState({ normalizationFallback: false });
  }),
);

/** The footer of one table, drawn from the store as the canvas draws it. */
function Live({ tableId }: { tableId: string }) {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const { statuses, errors, named } = useDerived();
  const table = tableViews(unionOf(baseline, desired), {
    statuses,
    errors,
    named,
  }).find((t) => t.id === tableId)!;
  return <NodeFooter table={table} />;
}
const desired = () => schemaStore.getState().desired;
const expand = () =>
  userEvent.click(screen.getByRole('button', { name: 'Indexes and checks' }));

// t:20 is billing.invoices: two indexes (one read-only), a check, an exclusion constraint, and a view on it
describe('NodeFooter', () => {
  test('says how many indexes and checks the table has, and what depends on it', () => {
    render(<Live tableId="t:20" />);
    expect(
      screen.getByRole('button', { name: 'Indexes and checks' }),
    ).toHaveTextContent('2 indexes · 1 check');
    const views = screen.getByText('1 view');
    expect(views).toHaveAttribute('title', 'view open_invoices');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  test('says none when there are none, and nothing about what does not depend on it', () => {
    render(<Live tableId="t:10" />);
    expect(
      screen.getByRole('button', { name: 'Indexes and checks' }),
    ).toHaveTextContent('0 indexes · 0 checks');
    expect(screen.queryByText(/view/)).not.toBeInTheDocument();
  });

  test('opens into the indexes and the constraints, and shuts again', async () => {
    render(<Live tableId="t:20" />);
    await expand();
    const indexes = screen.getByRole('list', { name: 'Indexes' });
    expect(
      within(indexes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('invoices_open_idx'),
      expect.stringContaining('invoices_user_id_idx'),
    ]);
    const constraints = screen.getByRole('list', { name: 'Constraints' });
    expect(within(constraints).getByText('(total >= 0)')).toBeInTheDocument();
    expect(within(constraints).getByText('exclusion')).toBeInTheDocument();
    await expand();
    expect(
      screen.queryByRole('list', { name: 'Indexes' }),
    ).not.toBeInTheDocument();
  });

  test('a read-only index and constraint have a lock, say why, and cannot be changed', async () => {
    render(<Live tableId="t:20" />);
    await expand();
    const [partial, plain] = screen.getAllByRole('listitem').slice(0, 2);
    expect(within(partial!).getByLabelText('Read-only')).toBeInTheDocument();
    expect(partial).toHaveAttribute(
      'title',
      expect.stringContaining('Read-only: partial index'),
    );
    expect(partial).toHaveAttribute(
      'title',
      expect.stringContaining('WHERE (total > 0)'),
    );
    expect(within(partial!).queryByRole('button')).not.toBeInTheDocument();
    // the plain index can be renamed and deleted
    expect(
      within(plain!).getByRole('button', { name: 'invoices_user_id_idx' }),
    ).toBeInTheDocument();
    expect(
      within(plain!).getByRole('button', { name: /Delete index/ }),
    ).toBeInTheDocument();
    const exclusion = screen.getByText('exclusion').closest('li')!;
    expect(within(exclusion).getByLabelText('Read-only')).toBeInTheDocument();
    expect(
      within(exclusion).queryByRole('button', { name: /Delete/ }),
    ).not.toBeInTheDocument();
  });

  test('deleting an index leaves it struck through to be brought back by a click', async () => {
    render(<Live tableId="t:20" />);
    await expand();
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete index invoices_user_id_idx' }),
    );
    expect(desired().indexes['i:1']).toBeUndefined();
    const row = screen.getByText('invoices_user_id_idx').closest('li')!;
    expect(row).toHaveAttribute('data-status', 'removed');
    expect(
      screen.getByRole('button', { name: 'Indexes and checks' }),
    ).toHaveTextContent('1 index ·');
    await userEvent.click(row);
    expect(desired().indexes['i:1']).toBeDefined();
  });

  test('renaming an index stops its name following its columns', async () => {
    render(<Live tableId="t:20" />);
    await expand();
    await userEvent.click(
      screen.getByRole('button', { name: 'invoices_user_id_idx' }),
    );
    await userEvent.keyboard('by_user{Enter}');
    expect(desired().indexes['i:1']).toMatchObject({ name: 'by_user' });
  });

  test('adds an index on the columns picked, in the order picked, named from them', async () => {
    render(<Live tableId="t:20" />);
    await expand();
    await userEvent.click(screen.getByRole('button', { name: /Index$/ }));
    const editor = screen.getByRole('group', { name: 'New index' });
    expect(
      within(editor).getByRole('button', { name: 'Add index' }),
    ).toBeDisabled();
    await userEvent.click(
      within(editor).getByRole('button', { name: 'total' }),
    );
    await userEvent.click(
      within(editor).getByRole('button', { name: 'user_id' }),
    );
    expect(
      within(editor).getByRole('button', { name: '1total' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(editor).getByRole('button', { name: '2user_id' }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(editor).getByRole('checkbox', { name: 'Unique' }),
    );
    await userEvent.click(
      within(editor).getByRole('button', { name: 'Add index' }),
    );

    const added = Object.values(desired().indexes).find((i) => i.autoName)!;
    expect(added).toMatchObject({
      tableId: 't:20',
      unique: true,
      columnIds: ['c:20:3', 'c:20:2'],
    });
    // closed, and in the list under the name the database gives it
    expect(
      screen.queryByRole('group', { name: 'New index' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('invoices_total_user_id_idx')).toBeInTheDocument();
  });

  test('a column picked twice is not picked, and Cancel adds nothing', async () => {
    render(<Live tableId="t:20" />);
    await expand();
    await userEvent.click(screen.getByRole('button', { name: /Index$/ }));
    const editor = screen.getByRole('group', { name: 'New index' });
    await userEvent.click(
      within(editor).getByRole('button', { name: 'total' }),
    );
    await userEvent.click(
      within(editor).getByRole('button', { name: '1total' }),
    );
    expect(
      within(editor).getByRole('button', { name: 'Add index' }),
    ).toBeDisabled();
    await userEvent.click(
      within(editor).getByRole('button', { name: 'Cancel' }),
    );
    expect(Object.keys(desired().indexes)).toHaveLength(2);
  });

  test('is opened by the toolbar asking to add an index', () => {
    render(<Live tableId="t:20" />);
    act(() => uiStore.getState().startEditing('t:20:index'));
    expect(
      screen.getByRole('group', { name: 'New index' }),
    ).toBeInTheDocument();
  });

  test('an index with an error shows it on its row', async () => {
    act(() => schemaStore.getState().renameIndex('i:1', 'invoices'));
    render(<Live tableId="t:20" />);
    await expand();
    const row = screen.getByText('invoices').closest('li')!;
    expect(row).toHaveAttribute('aria-invalid', 'true');
    expect(row.getAttribute('title')).toMatch(/invoices/);
  });
});

describe('adding a check', () => {
  const answer = (expression: string) =>
    installFakeApi({
      'expr.normalize': () => ({
        status: 'normalized',
        expression: `(${expression})`,
        columnIds: ['c:20:2', 'c:20:3'],
      }),
    });

  test('adds the expression as Postgres read it, with the columns it uses', async () => {
    answer('user_id > total');
    render(<Live tableId="t:20" />);
    await expand();
    await userEvent.click(screen.getByRole('button', { name: /Check$/ }));
    const add = screen.getByRole('button', { name: 'Add check' });
    expect(add).toBeDisabled();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Check expression' }),
      'user_id > total',
    );
    await waitFor(() => expect(add).toBeEnabled(), { timeout: 2000 });
    await userEvent.click(add);
    const check = Object.values(desired().constraints).find(
      (c) => c.kind === 'check' && c.autoName,
    );
    expect(check).toMatchObject({
      expression: '(user_id > total)',
      columnIds: ['c:20:2', 'c:20:3'],
    });
    expect(
      screen.queryByRole('group', { name: 'New check' }),
    ).not.toBeInTheDocument();
  });

  test("a check Postgres rejects shows its message and can't be added", async () => {
    installFakeApi({
      'expr.normalize': () => ({
        status: 'invalid',
        message: 'column "nope" does not exist',
      }),
    });
    render(<Live tableId="t:20" />);
    act(() => uiStore.getState().startEditing('t:20:check'));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Check expression' }),
      'nope > 0',
    );
    expect(
      await screen.findByRole('alert', {}, { timeout: 2000 }),
    ).toHaveTextContent('does not exist');
    expect(screen.getByRole('button', { name: 'Add check' })).toBeDisabled();
  });

  test('when expressions are kept as typed there is no way to add one, and it says why', () => {
    act(() => uiStore.setState({ normalizationFallback: true }));
    render(<Live tableId="t:20" />);
    act(() => uiStore.getState().startEditing('t:20:check'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /can't create temporary tables/,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add check' })).toBeDisabled();
  });

  test('deleting a check marks it removed', async () => {
    render(<Live tableId="t:20" />);
    await expand();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Delete constraint invoices_total_check',
      }),
    );
    expect(desired().constraints['k:3']).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'Indexes and checks' }),
    ).toHaveTextContent('0 checks');
  });
});

describe('the footer of a table that cannot be edited', () => {
  test('has no add buttons', async () => {
    act(() =>
      schemaStore
        .getState()
        .edit((d) => void (d.tables['t:20']!.readOnly = 'partitioned-table')),
    );
    render(<Live tableId="t:20" />);
    await expand();
    expect(
      screen.queryByRole('button', { name: /Index$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Check$/ }),
    ).not.toBeInTheDocument();
  });
});
