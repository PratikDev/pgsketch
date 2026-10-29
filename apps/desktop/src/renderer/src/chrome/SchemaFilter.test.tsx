import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { SchemaFilter } from './SchemaFilter';

const casts = { categories: {}, domains: {}, casts: {} };

beforeEach(() =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  ),
);
afterEach(() => act(() => uiStore.getState().showAllSchemas()));

describe('SchemaFilter', () => {
  test('counts the schemas that are shown, and lists them with a tick for each', async () => {
    render(<SchemaFilter />);
    expect(screen.getByRole('button', { name: 'Schemas (2/2)' })).toBeVisible();
    await userEvent.click(screen.getByRole('button'));
    expect(
      screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent),
    ).toEqual(['billing', 'public']);
    for (const item of screen.getAllByRole('menuitemcheckbox'))
      expect(item).toBeChecked();
  });

  test('unticking a schema hides it and keeps the menu open for the next one', async () => {
    render(<SchemaFilter />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'billing' }),
    );
    expect(uiStore.getState().hiddenSchemas).toEqual(['s:2']);
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'billing' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Schemas (1/2)', hidden: true }),
    ).toBeInTheDocument();
  });

  test('show all is only there to use when something is hidden, and brings everything back', async () => {
    render(<SchemaFilter />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: 'Show all' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'public' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show all' }));
    expect(uiStore.getState().hiddenSchemas).toEqual([]);
  });

  test('a schema the migration creates has a pen and a trash can that work without ticking the row', async () => {
    let id = '';
    act(() => void (id = schemaStore.getState().addSchema()));
    render(<SchemaFilter />);
    await userEvent.click(screen.getByRole('button'));
    for (const name of ['billing', 'public'])
      expect(
        within(screen.getByRole('menuitemcheckbox', { name })).queryByRole(
          'button',
        ),
      ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Rename schema new_schema' }),
    );
    expect(uiStore.getState().hiddenSchemas).toEqual([]);
    await userEvent.keyboard('audit{Enter}');
    expect(schemaStore.getState().desired.schemas[id]!.name).toBe('audit');

    await userEvent.click(
      screen.getByRole('button', { name: 'Delete schema audit' }),
    );
    expect(schemaStore.getState().desired.schemas[id]).toBeUndefined();
    expect(uiStore.getState().hiddenSchemas).toEqual([]);
    expect(
      screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent),
    ).toEqual(['billing', 'public']);
  });
});
