import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fixtureModel } from '@/test-model';
import { emptyModel } from '@/stores/schema/core';
import { layoutStore } from '@/stores/layout';
import { schemaStore } from '@/stores/schema';
import { installFakeApi } from '@/test-utils';
import { Canvas } from './Canvas';

const casts = { categories: {}, domains: {}, casts: {} };
const saved = vi.hoisted(() => ({
  positions: {} as Record<string, { x: number; y: number }>,
}));
const load = async (model = fixtureModel) => {
  installFakeApi({
    'layout.get': () => saved.positions,
    'layout.put': () => undefined,
  });
  act(() => schemaStore.getState().load({ model, casts, fingerprint: 'f' }));
  await act(() =>
    layoutStore.getState().restore('k', Object.keys(model.tables)),
  );
};

afterEach(async () => {
  saved.positions = {};
  await load(emptyModel());
});

/** The real layout, run in this thread instead of a worker, or made to fail. */
const elk = new ELK();
const layout = vi.hoisted(() => ({ fail: false }));
vi.mock('@/layout/autoLayout', async (original) => {
  const module = await original<typeof import('@/layout/autoLayout')>();
  return {
    ...module,
    autoLayout: (
      tables: Parameters<typeof module.autoLayout>[0],
      links: Parameters<typeof module.autoLayout>[1],
    ) =>
      module.autoLayout(tables, links, (graph) =>
        layout.fail
          ? Promise.reject(new Error('no worker'))
          : elk.layout(graph),
      ),
  };
});

const nodes = (container: HTMLElement) =>
  container.querySelectorAll('.react-flow__node');
// React Flow keeps a node hidden until the browser has measured it, which jsdom never does
const tableNames = () =>
  screen
    .getAllByRole('region', { hidden: true })
    .map((r) => r.getAttribute('aria-label'));

describe('Canvas', () => {
  test('draws one node for every table of the loaded schema', async () => {
    await load();
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

  test('draws nothing for a schema with no tables', async () => {
    await load(emptyModel());
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    expect(nodes(container)).toHaveLength(0);
  });

  test('keeps a removed table on the canvas, and shows an added one', async () => {
    await load();
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

  test('shows a renamed table under its new name, once', async () => {
    await load();
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    act(() => schemaStore.getState().renameTable('t:10', 'people'));
    expect(tableNames()).toContain('public.people');
    expect(tableNames()).not.toContain('public.users');
  });

  test('every node has its own position, so no two tables are drawn on top of each other', async () => {
    await load();
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

  test('every row has the four ends a foreign key line can have', async () => {
    await load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    const rows = 2 + 3 + 0; // users, invoices and events
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(
      rows * 4,
    );
  });

  test('the layout places the tables, and the canvas says it is done', async () => {
    layout.fail = false;
    await load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-layout="ready"]')).not.toBeNull(),
    );
    // invoices points at users, so it is to the left of it
    const x = (name: string) => {
      const node = container.querySelector(
        `[data-id="${name}"]`,
      ) as HTMLElement;
      return Number(/translate\((-?[\d.]+)px/.exec(node.style.transform)?.[1]);
    };
    expect(x('t:20')).toBeLessThan(x('t:10'));
  });

  test('if the layout fails the tables stay on the grid, and the canvas says so', async () => {
    layout.fail = true;
    await load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-layout="failed"]')).not.toBeNull(),
    );
    expect(nodes(container)).toHaveLength(3);
    layout.fail = false;
  });

  test('a table is drawn where the layout store says it is, which is where it was dragged', async () => {
    await load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    act(() => layoutStore.getState().place({ 't:10': { x: 1234, y: 567 } }));
    const node = container.querySelector('[data-id="t:10"]') as HTMLElement;
    expect(node.style.transform).toContain('translate(1234px,567px)');
  });

  test('tables that already have a saved position stay put, and are not laid out again', async () => {
    saved.positions = {
      't:10': { x: 10, y: 20 },
      't:20': { x: 700, y: 20 },
      't:30': { x: 10, y: 600 },
    };
    await load();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-layout="ready"]')).not.toBeNull(),
    );
    expect(layoutStore.getState().positions).toEqual(saved.positions);
    const node = container.querySelector('[data-id="t:20"]') as HTMLElement;
    expect(node.style.transform).toContain('translate(700px,20px)');
  });

  test('only the new table is placed by the layout when some tables already have a position', async () => {
    saved.positions = { 't:10': { x: 10, y: 20 }, 't:20': { x: 700, y: 20 } };
    await load();
    render(
      <div style={{ width: 800, height: 600 }}>
        <Canvas />
      </div>,
    );
    await waitFor(() =>
      expect(layoutStore.getState().positions['t:30']).toBeDefined(),
    );
    expect(layoutStore.getState().positions['t:10']).toEqual({ x: 10, y: 20 });
    expect(layoutStore.getState().positions['t:20']).toEqual({ x: 700, y: 20 });
  });
});
