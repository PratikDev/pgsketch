import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { installFakeApi } from '@/test-utils';
import { ReloadDialog } from './ReloadDialog';
import { requestReload } from './reload';

// toasts are drawn by the Toaster, which these tests don't mount
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const casts = { categories: {}, domains: {}, casts: {} };
const reloaded = () => ({ model: fixtureModel, casts, fingerprint: 'f1' });

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f0' }),
  );
});
afterEach(() => act(() => uiStore.getState().setReloadAsked(false)));

const edit = () =>
  act(() => {
    schemaStore.getState().renameTable('t:10', 'people');
    schemaStore.getState().renameColumn('c:10:2', 'state');
  });

describe('ReloadDialog', () => {
  test('is nothing until it is asked, then asks, naming how many edits go', async () => {
    edit();
    render(<ReloadDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => uiStore.getState().setReloadAsked(true));
    expect(
      await screen.findByRole('heading', {
        name: 'Reload and discard 2 unsaved changes?',
      }),
    ).toBeInTheDocument();
  });

  test('nothing is read, and nothing is lost, until it is confirmed; then the edits are gone', async () => {
    const calls = installFakeApi({ 'schema.load': reloaded });
    edit();
    act(() => uiStore.getState().setReloadAsked(true));
    render(<ReloadDialog />);
    expect(calls).toEqual([]);
    expect(schemaStore.getState().desired.tables['t:10']!.name).toBe('people');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reload and discard' }),
    );
    await waitFor(() =>
      expect(schemaStore.getState().loadedFingerprint).toBe('f1'),
    );
    expect(schemaStore.getState().desired.tables['t:10']!.name).toBe('users');
    expect(uiStore.getState().reloadAsked).toBe(false);
  });

  test('Cancel keeps everything as it was', async () => {
    const calls = installFakeApi({ 'schema.load': reloaded });
    edit();
    act(() => uiStore.getState().setReloadAsked(true));
    render(<ReloadDialog />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel' }),
    );
    expect(calls).toEqual([]);
    expect(schemaStore.getState().desired.tables['t:10']!.name).toBe('people');
    expect(uiStore.getState().reloadAsked).toBe(false);
  });

  test('a reload that cannot read the database says so, and keeps the edits', async () => {
    installFakeApi({
      'schema.load': () => {
        throw new Error('connection lost');
      },
    });
    edit();
    act(() => uiStore.getState().setReloadAsked(true));
    render(<ReloadDialog />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reload and discard' }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('connection lost'),
      ),
    );
    expect(schemaStore.getState().desired.tables['t:10']!.name).toBe('people');
  });
});

describe('requestReload', () => {
  test('with edits it asks; with none it reloads at once', async () => {
    const calls = installFakeApi({ 'schema.load': reloaded });
    requestReload();
    await waitFor(() =>
      expect(schemaStore.getState().loadedFingerprint).toBe('f1'),
    );
    expect(calls).toHaveLength(1);
    expect(uiStore.getState().reloadAsked).toBe(false);

    edit();
    requestReload();
    expect(uiStore.getState().reloadAsked).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
