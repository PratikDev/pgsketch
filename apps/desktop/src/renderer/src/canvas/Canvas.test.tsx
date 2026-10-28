import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { emptyModel } from '@/stores/schema/core';
import { schemaStore } from '@/stores/schema';
import { Canvas } from './Canvas';

const casts = { categories: {}, domains: {}, casts: {} };
const load = (model = fixtureModel) =>
  act(() => schemaStore.getState().load({ model, casts, fingerprint: 'f' }));

afterEach(() => load(emptyModel()));

const nodes = (container: HTMLElement) =>
  container.querySelectorAll('.react-flow__node');
// React Flow keeps a node hidden until the browser has measured it, which jsdom never does
const tableNames = () =>
  screen
    .getAllByRole('region', { hidden: true })
    .map((r) => r.getAttribute('aria-label'));

describe('Canvas', () => {
  test('draws one node for every table of the loaded schema', () => {
    load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    expect(nodes(container)).toHaveLength(3);
    expect(tableNames().sort()).toEqual([
      'billing.invoices',
      'public.events',
      'public.users',
    ]);
  });

  test('draws nothing for a schema with no tables', () => {
    load(emptyModel());
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    expect(nodes(container)).toHaveLength(0);
  });

  test('keeps a removed table on the canvas, and shows an added one', () => {
    load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    act(() => void schemaStore.getState().removeTable('t:10'));
    expect(tableNames()).toContain('public.users');
    act(() => void schemaStore.getState().addTable('s:1'));
    expect(nodes(container)).toHaveLength(4);
    expect(tableNames()).toContain('public.new_table');
  });

  test('shows a renamed table under its new name, once', () => {
    load();
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    act(() => schemaStore.getState().renameTable('t:10', 'people'));
    expect(tableNames()).toContain('public.people');
    expect(tableNames()).not.toContain('public.users');
  });

  test('every node has its own position, so no two tables are drawn on top of each other', () => {
    load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    const places = [...nodes(container)].map(
      (n) => (n as HTMLElement).style.transform,
    );
    expect(new Set(places).size).toBe(places.length);
  });
});
