import ELK from 'elkjs/lib/elk.bundled.js';
import { act } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { layoutStore } from '@/stores/layout';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { installFakeApi } from '@/test-utils';
import { arrangeAll } from './arrange';

// toasts are drawn by the Toaster, which these tests don't mount
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

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

const casts = { categories: {}, domains: {}, casts: {} };
const elsewhere = {
  't:10': { x: 5000, y: 5000 },
  't:20': { x: -5000, y: 0 },
  't:30': { x: 1, y: 1 },
};

beforeEach(async () => {
  layout.fail = false;
  vi.mocked(toast.error).mockClear();
  installFakeApi({
    'layout.get': () => elsewhere,
    'layout.put': () => undefined,
  });
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  );
  await act(() =>
    layoutStore.getState().restore('k', Object.keys(fixtureModel.tables)),
  );
});

describe('arrangeAll', () => {
  test('lays out every table anew, those that had a place too, and asks for the view to be fitted', async () => {
    const before = uiStore.getState().fitRequests;
    await act(() => arrangeAll());
    const after = layoutStore.getState().positions;
    expect(Object.keys(after).sort()).toEqual(['t:10', 't:20', 't:30']);
    expect(after['t:10']).not.toEqual(elsewhere['t:10']);
    expect(after['t:20']).not.toEqual(elsewhere['t:20']);
    expect(uiStore.getState().fitRequests).toBe(before + 1);
  });

  test('includes a table the user has added, which is not in the database yet', async () => {
    let id = '';
    act(() => void (id = schemaStore.getState().addTable('s:1')));
    await act(() => arrangeAll());
    expect(layoutStore.getState().positions[id]).toBeDefined();
  });

  test('when the layout fails it says so, and leaves the tables where they are', async () => {
    layout.fail = true;
    const before = uiStore.getState().fitRequests;
    await act(() => arrangeAll());
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('no worker'),
    );
    expect(layoutStore.getState().positions).toEqual(elsewhere);
    expect(uiStore.getState().fitRequests).toBe(before);
  });
});
