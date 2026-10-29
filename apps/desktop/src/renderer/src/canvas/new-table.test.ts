import type { Schema } from '@pgsketch/core';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { layoutStore } from '@/stores/layout';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { createTableAt, newTableSchema } from './new-table';

const schema = (id: string, name: string): Schema => ({ id, name });
const [pub, billing, audit] = [
  schema('s:1', 'public'),
  schema('s:2', 'billing'),
  schema('s:3', 'audit'),
];

describe('newTableSchema', () => {
  test('is the only schema the filter shows', () => {
    expect(newTableSchema([pub, billing], ['s:1'])).toBe('s:2');
    expect(newTableSchema([pub, billing, audit], ['s:1', 's:3'])).toBe('s:2');
  });

  test('is public when several are shown and it is one of them', () => {
    expect(newTableSchema([pub, billing], [])).toBe('s:1');
    expect(newTableSchema([pub, billing, audit], ['s:3'])).toBe('s:1');
  });

  test('is the first by name when public is not shown, or there is none', () => {
    expect(newTableSchema([billing, audit], [])).toBe('s:3');
    expect(newTableSchema([pub, billing, audit], ['s:1'])).toBe('s:3');
  });

  test('when the filter hides every schema it is still the first by name, and none for none', () => {
    expect(newTableSchema([pub, billing], ['s:1', 's:2'])).toBe('s:2');
    expect(newTableSchema([], [])).toBeNull();
  });
});

describe('createTableAt', () => {
  const casts = { categories: {}, domains: {}, casts: {} };
  beforeEach(() =>
    act(() =>
      schemaStore
        .getState()
        .load({ model: fixtureModel, casts, fingerprint: 'f' }),
    ),
  );
  afterEach(() => act(() => uiStore.getState().showAllSchemas()));

  test('adds a table with its key column, puts it where it was asked, and opens its name', () => {
    createTableAt({ x: 120, y: 340 });
    const table = Object.values(schemaStore.getState().desired.tables).find(
      (t) => t.name === 'new_table',
    )!;
    expect(table.schemaId).toBe('s:1');
    expect(
      Object.values(schemaStore.getState().desired.columns)
        .filter((c) => c.tableId === table.id)
        .map((c) => c.name),
    ).toEqual(['id']);
    expect(layoutStore.getState().positions[table.id]).toEqual({
      x: 120,
      y: 340,
    });
    expect(uiStore.getState().editing).toBe(`${table.id}:name`);
  });

  test('lands in the schema the filter leaves showing', () => {
    uiStore.getState().toggleSchema('s:1');
    createTableAt({ x: 0, y: 0 });
    const table = Object.values(schemaStore.getState().desired.tables).find(
      (t) => t.name === 'new_table',
    )!;
    expect(table.schemaId).toBe('s:2');
  });
});
