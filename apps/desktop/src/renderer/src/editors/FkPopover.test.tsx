import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { FkPopover } from './FkPopover';

const casts = { categories: {}, domains: {}, casts: {} };
beforeEach(() =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  ),
);
afterEach(() => act(() => uiStore.getState().cancelEditing()));

// k:2 is invoices.user_id → users.id, ON DELETE CASCADE in the fixture or no action; the key is editable
const open = (id = 'k:2') => {
  render(<FkPopover anchor={{ x: 100, y: 100 }} />);
  act(() => uiStore.getState().startEditing(`${id}:fk`));
};
const key = (id = 'k:2') => {
  const c = schemaStore.getState().desired.constraints[id];
  return c?.kind === 'fk' ? c : undefined;
};
const chooseAction = async (label: string, action: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: action }));
};

describe('FkPopover', () => {
  test('is nothing until a key is being edited, and nothing for what is not a foreign key', () => {
    render(<FkPopover anchor={{ x: 0, y: 0 }} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => uiStore.getState().startEditing('k:1:fk')); // a primary key
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('says which key it is', () => {
    open();
    expect(screen.getByText('invoices.user_id → users.id')).toBeInTheDocument();
  });

  test('changes what happens on delete and on update, each by itself', async () => {
    open();
    await chooseAction('On delete', 'cascade');
    expect(key()?.onDelete).toBe('cascade');
    await chooseAction('On update', 'set null');
    expect(key()).toMatchObject({ onDelete: 'cascade', onUpdate: 'set null' });
  });

  test('removes the key and closes', async () => {
    open();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove foreign key' }),
    );
    expect(key()).toBeUndefined();
    expect(uiStore.getState().editing).toBeNull();
  });

  test('a key the change drops can only be restored, and restoring brings it back', async () => {
    act(() => void schemaStore.getState().removeConstraint('k:2'));
    open();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Restore foreign key' }),
    );
    expect(key()).toBeDefined();
  });

  test('a read-only key has nothing to change, and says why', () => {
    act(() =>
      schemaStore.getState().edit((d) => {
        const c = d.constraints['k:2'];
        if (c) c.readOnly = 'deferrable';
      }),
    );
    open();
    expect(screen.getByText(/Read-only: deferrable/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /foreign key/ }),
    ).not.toBeInTheDocument();
  });
});
