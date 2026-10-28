import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { ColumnRow } from './ColumnRow';
import { tableViews } from './model-view';

const casts = { categories: {}, domains: {}, casts: {} };
const load = () =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  );
beforeEach(load);
afterEach(() => act(() => uiStore.setState({ editing: null })));

/** One row, redrawn from the store as the real canvas would. */
function Live({ columnId }: { columnId: string }) {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const column = tableViews(desired, undefined)
    .flatMap((t) => t.columns)
    .find((c) => c.id === columnId)!;
  void baseline;
  return (
    <ReactFlowProvider>
      <ul>
        <ColumnRow column={column} />
      </ul>
    </ReactFlowProvider>
  );
}
const desired = () => schemaStore.getState().desired;
const badge = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) });

// c:20:2 is billing.invoices.user_id; c:10:1 is public.users.id (an identity column in a key)
describe('the PK, NN and UQ switches', () => {
  test('NN turns NOT NULL on and off', async () => {
    render(<Live columnId="c:20:3" />); // total, nullable
    expect(badge('NN')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(badge('NN'));
    expect(desired().columns['c:20:3']!.notNull).toBe(true);
    expect(badge('NN')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(badge('NN'));
    expect(desired().columns['c:20:3']!.notNull).toBe(false);
  });

  test('PK puts the column in the key and turns NN on and locks it; turning PK off leaves NN on', async () => {
    act(() => schemaStore.getState().setNotNull('c:20:3', false));
    render(<Live columnId="c:20:3" />);
    expect(badge('NN')).toBeEnabled();
    await userEvent.click(badge('PK'));
    expect(badge('PK')).toHaveAttribute('aria-pressed', 'true');
    expect(badge('NN')).toHaveAttribute('aria-pressed', 'true');
    expect(badge('NN')).toBeDisabled();
    expect(badge('NN')).toHaveAttribute(
      'title',
      'NOT NULL: required by the primary key',
    );
    await userEvent.click(badge('PK'));
    expect(badge('PK')).toHaveAttribute('aria-pressed', 'false');
    expect(badge('NN')).toHaveAttribute('aria-pressed', 'true');
    expect(badge('NN')).toBeEnabled();
  });

  test('NN is locked on an identity column', () => {
    act(() => schemaStore.getState().setPrimaryKey('c:10:1', false));
    render(<Live columnId="c:10:1" />);
    expect(badge('NN')).toBeDisabled();
    expect(badge('NN')).toHaveAttribute(
      'title',
      'NOT NULL: required by the identity column',
    );
  });

  test('UQ adds and removes the unique constraint of just that column', async () => {
    const uniqueOn = () =>
      Object.values(desired().constraints).filter(
        (c) => c.kind === 'unique' && c.columnIds.join() === 'c:20:2',
      );
    render(<Live columnId="c:20:2" />);
    await userEvent.click(badge('UQ'));
    expect(uniqueOn()).toHaveLength(1);
    expect(badge('UQ')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(badge('UQ'));
    expect(uniqueOn()).toHaveLength(0);
  });

  test('none of them can be used on a read-only column or a removed one', () => {
    act(() => void schemaStore.getState().removeColumn('c:20:2'));
    render(<ReadOnlyOrRemoved />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});

/** The removed column, drawn from the union of the models like the canvas does. */
function ReadOnlyOrRemoved() {
  const { statuses, errors } = {
    statuses: { 'c:20:2': { status: 'removed' as const, old: {} } },
    errors: [],
  };
  const column = tableViews(fixtureModel, { statuses, errors })
    .flatMap((t) => t.columns)
    .find((c) => c.id === 'c:20:2')!;
  return (
    <ReactFlowProvider>
      <ul>
        <ColumnRow column={column} />
      </ul>
    </ReactFlowProvider>
  );
}
