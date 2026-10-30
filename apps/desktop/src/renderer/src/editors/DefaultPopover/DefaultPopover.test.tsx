import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NormalizedExpression } from '@pgsketch/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tableViews, unionOf } from '@/canvas/model-view';
import { useDerived } from '@/stores/derived';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { installFakeApi } from '@/test-utils';
import { clearNormalizeCache } from '@/editors/ExpressionInput/normalize-cache';
import { DefaultPopover } from '.';

// toasts are drawn by the Toaster, which these tests don't mount
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

const casts = { categories: {}, domains: {}, casts: {} };
let answers: Record<string, NormalizedExpression>;
let asked: string[];

beforeEach(() => {
  clearNormalizeCache();
  asked = [];
  answers = {};
  installFakeApi({
    'expr.normalize': ({ expression }) => {
      asked.push(expression);
      return (
        answers[expression] ?? {
          status: 'normalized',
          expression,
          columnIds: [],
        }
      );
    },
  });
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  );
});
afterEach(() => act(() => uiStore.getState().cancelEditing()));

/** One column's popover, drawn from the store as the row draws it. */
function Live({ columnId }: { columnId: string }) {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const { statuses, errors } = useDerived();
  const column = tableViews(unionOf(baseline, desired), { statuses, errors })
    .flatMap((t) => t.columns)
    .find((c) => c.id === columnId)!;
  return <DefaultPopover column={column} editable={!column.state.readOnly} />;
}
const defaultOf = (id: string) =>
  schemaStore.getState().desired.columns[id]!.default;
const chip = (name: RegExp | string) => screen.getByRole('button', { name });

// c:10:2 is users.status (an enum, default 'active'); c:20:3 is invoices.total (numeric, default 0)
describe('DefaultPopover', () => {
  test('shows the default as a chip that opens the presets for the type', async () => {
    render(<Live columnId="c:20:3" />);
    expect(chip(/^Default: 0/)).toHaveTextContent('= 0');
    await userEvent.click(chip(/^Default: 0/));
    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Presets' })).toBeInTheDocument();
  });

  test("an enum's presets are its labels; choosing one sets it, as Postgres writes it", async () => {
    answers["'banned'"] = {
      status: 'normalized',
      expression: "'banned'::user_status",
      columnIds: [],
    };
    render(<Live columnId="c:10:2" />);
    await userEvent.click(chip(/^Default/));
    await userEvent.click(screen.getByRole('button', { name: "'banned'" }));
    await waitFor(() =>
      expect(defaultOf('c:10:2')).toEqual({
        kind: 'preset',
        preset: 'enum:banned',
        expression: "'banned'::user_status",
      }),
    );
    // done: the popover closes
    expect(
      screen.queryByRole('tab', { name: 'Presets' }),
    ).not.toBeInTheDocument();
  });

  test('a constant is quoted for a text type, and set as Postgres reads it', async () => {
    let id = '';
    act(() => void (id = schemaStore.getState().addColumn('t:20')));
    render(<Live columnId={id} />);
    await userEvent.click(chip('Add a default'));
    await userEvent.click(screen.getByRole('tab', { name: 'Constant' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Constant' }),
      "it's",
    );
    await userEvent.click(screen.getByRole('button', { name: 'Set default' }));
    await waitFor(() =>
      expect(defaultOf(id)).toEqual({
        kind: 'constant',
        expression: "'it''s'",
      }),
    );
    expect(asked).toEqual(["'it''s'"]);
  });

  test('an expression is set once Postgres has read it, in the form it gives back', async () => {
    answers['now() + 1'] = {
      status: 'normalized',
      expression: '(now() + 1)',
      columnIds: [],
    };
    let id = '';
    act(() => void (id = schemaStore.getState().addColumn('t:20')));
    render(<Live columnId={id} />);
    await userEvent.click(chip('Add a default'));
    await userEvent.click(screen.getByRole('tab', { name: 'Expression' }));
    const set = screen.getByRole('button', { name: 'Set default' });
    expect(set).toBeDisabled();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Expression' }),
      'now() + 1',
    );
    await waitFor(() => expect(set).toBeEnabled(), { timeout: 2000 });
    await userEvent.click(set);
    await waitFor(() =>
      expect(defaultOf(id)).toEqual({
        kind: 'expression',
        expression: '(now() + 1)',
      }),
    );
  });

  test('a preset Postgres rejects says why, keeps the popover open and the default as it was', async () => {
    answers['0'] = {
      status: 'invalid',
      message: 'default is of the wrong type',
    };
    render(<Live columnId="c:20:3" />);
    await userEvent.click(chip(/^Default/));
    await userEvent.click(screen.getByRole('button', { name: '0' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'default is of the wrong type',
    );
    expect(defaultOf('c:20:3')).toEqual(
      fixtureModel.columns['c:20:3']!.default,
    );
    expect(screen.getByRole('tab', { name: 'Presets' })).toBeInTheDocument();
  });

  test('Remove default takes it away', async () => {
    render(<Live columnId="c:20:3" />);
    await userEvent.click(chip(/^Default/));
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove default' }),
    );
    expect(defaultOf('c:20:3')).toBeNull();
  });

  test('an identity column has no chip to open, and one with a sequence default is plain text', () => {
    render(<Live columnId="c:10:1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('a read-only column shows its default and cannot open it', () => {
    render(<Live columnId="c:20:1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTitle(/^Default: nextval/)).toBeInTheDocument();
  });

  test('a presets answer asked before is not asked again', async () => {
    render(<Live columnId="c:20:3" />);
    await userEvent.click(chip(/^Default/));
    await userEvent.click(screen.getByRole('button', { name: '0' }));
    await waitFor(() => expect(asked).toEqual(['0']));
    await userEvent.click(chip(/^Default/));
    await userEvent.click(screen.getByRole('button', { name: '0' }));
    expect(asked).toEqual(['0']);
  });
});
