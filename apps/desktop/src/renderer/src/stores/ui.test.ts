import { describe, expect, test } from 'vitest';
import { createUiStore } from './ui';

describe('the schema filter', () => {
  test('shows every schema until one is hidden, and hiding is undone by toggling again', () => {
    const store = createUiStore();
    expect(store.getState().hiddenSchemas).toEqual([]);
    store.getState().toggleSchema('s:1');
    store.getState().toggleSchema('s:2');
    expect(store.getState().hiddenSchemas).toEqual(['s:1', 's:2']);
    store.getState().toggleSchema('s:1');
    expect(store.getState().hiddenSchemas).toEqual(['s:2']);
  });

  test('show all brings every schema back', () => {
    const store = createUiStore();
    store.getState().toggleSchema('s:1');
    store.getState().showAllSchemas();
    expect(store.getState().hiddenSchemas).toEqual([]);
  });
});
