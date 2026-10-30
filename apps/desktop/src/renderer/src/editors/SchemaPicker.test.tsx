import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tableViews, unionOf } from '@/canvas/model-view';
import { useDerived } from '@/stores/derived';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { SchemaPicker } from './SchemaPicker';

// toasts are drawn by the Toaster, which these tests don't mount: they check what was asked of `toast`
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const casts = { categories: {}, domains: {}, casts: {} };
beforeEach(() =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  ),
);
afterEach(() =>
  act(() => {
    uiStore.getState().cancelEditing();
    vi.mocked(toast.error).mockClear();
  }),
);

/** The picker of one table, drawn from the store as the canvas draws it. */
function Live({ tableId }: { tableId: string }) {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const { statuses, errors } = useDerived();
  const table = tableViews(unionOf(baseline, desired), {
    statuses,
    errors,
  }).find((t) => t.id === tableId)!;
  return <SchemaPicker table={table} />;
}
const newTable = () => {
  let id = '';
  act(() => void (id = schemaStore.getState().addTable('s:1')));
  return id;
};
const open = () =>
  userEvent.click(screen.getByRole('button', { name: 'Schema' }));

describe('SchemaPicker', () => {
  test('is plain text for a table that is in the database', () => {
    render(<Live tableId="t:10" />);
    expect(screen.getByText('public.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('is a menu of the schemas, with the current one ticked, for a new table', async () => {
    render(<Live tableId={newTable()} />);
    await open();
    expect(
      screen.getAllByRole('menuitemradio').map((i) => i.textContent),
    ).toEqual(['billing', 'public']);
    expect(screen.getByRole('menuitemradio', { name: 'public' })).toBeChecked();
    expect(
      screen.queryByRole('menuitem', { name: 'Rename schema' }),
    ).not.toBeInTheDocument();
  });

  test('choosing a schema moves the table there', async () => {
    const id = newTable();
    render(<Live tableId={id} />);
    await open();
    await userEvent.click(
      screen.getByRole('menuitemradio', { name: 'billing' }),
    );
    expect(schemaStore.getState().desired.tables[id]!.schemaId).toBe('s:2');
    expect(screen.getByRole('button', { name: 'Schema' })).toHaveTextContent(
      'billing.',
    );
  });

  test('New schema… makes a schema, moves the table to it and opens its name in the menu; typing renames it', async () => {
    const id = newTable();
    render(<Live tableId={id} />);
    await open();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'New schema…' }),
    );
    const moved = schemaStore.getState().desired.tables[id]!.schemaId;
    expect(schemaStore.getState().desired.schemas[moved]!.name).toBe(
      'new_schema',
    );
    expect(uiStore.getState().editing).toBe(`${moved}:name`);
    const input = screen.getByRole('textbox', { name: 'Schema name' });
    expect(input).toHaveValue('new_schema');
    expect(input).toHaveFocus();
    // letters typed in the input stay in the input: the menu doesn't search its items with them
    await userEvent.keyboard('audit{Enter}');
    expect(schemaStore.getState().desired.schemas[moved]!.name).toBe('audit');
    expect(screen.getByRole('menuitemradio', { name: 'audit' })).toBeChecked();
  });

  describe('the pen and the trash can', () => {
    const withNewSchema = () => {
      const table = newTable();
      let schema = '';
      act(() => void (schema = schemaStore.getState().addSchema()));
      render(<Live tableId={table} />);
      return { table, schema };
    };

    test('are on the row of a schema the migration creates and no other', async () => {
      withNewSchema();
      await open();
      const row = (name: string) =>
        screen.getByRole('menuitemradio', { name: new RegExp(`^${name}`) });
      for (const name of ['billing', 'public'])
        expect(within(row(name)).queryByRole('button')).not.toBeInTheDocument();
      expect(
        within(row('new_schema')).getByRole('button', {
          name: 'Rename schema new_schema',
        }),
      ).toBeInTheDocument();
      expect(
        within(row('new_schema')).getByRole('button', {
          name: 'Delete schema new_schema',
        }),
      ).toBeInTheDocument();
    });

    test('the pen opens the name in the row, without moving the table or closing the menu', async () => {
      const { table, schema } = withNewSchema();
      await open();
      await userEvent.click(
        screen.getByRole('button', { name: 'Rename schema new_schema' }),
      );
      expect(uiStore.getState().editing).toBe(`${schema}:name`);
      expect(schemaStore.getState().desired.tables[table]!.schemaId).toBe(
        's:1',
      );
      await userEvent.keyboard('audit{Enter}');
      expect(schemaStore.getState().desired.schemas[schema]!.name).toBe(
        'audit',
      );
      expect(
        screen.getByRole('menuitemradio', { name: /^audit/ }),
      ).toBeVisible();
    });

    test('the trash can deletes an empty schema from the model and the list', async () => {
      const { schema } = withNewSchema();
      await open();
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete schema new_schema' }),
      );
      expect(schemaStore.getState().desired.schemas[schema]).toBeUndefined();
      expect(
        screen.queryByRole('menuitemradio', { name: /new_schema/ }),
      ).not.toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    test('the trash can on a schema with a table in it says so, and deletes nothing', async () => {
      const { table, schema } = withNewSchema();
      act(() => void schemaStore.getState().setTableSchema(table, schema));
      await open();
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete schema new_schema' }),
      );
      expect(schemaStore.getState().desired.schemas[schema]).toBeDefined();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(
          /Can't delete schema "new_schema": table "new_table" is in it/,
        ),
        expect.anything(),
      );
    });
  });
});
