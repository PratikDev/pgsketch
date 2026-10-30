import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { emptyModel } from '@/stores/schema/core';
import { schemaStore } from '@/stores/schema';
import { installFakeApi } from '@/test-utils';
import { fixtureModel } from '@/test-model';
import type { SessionInfo } from '../../../../shared/ipc-contract';
import { Editor } from '.';
import { toast } from 'sonner';

// toasts are drawn by the Toaster, which these tests don't mount: they check what was asked of `toast`
vi.mock('sonner', () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));

const session: SessionInfo = {
  serverVersion: '16.4',
  database: 'app',
  host: 'localhost',
  hostKind: 'local',
  dbKey: 'k',
  saved: null,
};
const casts = { categories: {}, domains: {}, casts: {} };

afterEach(() =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: emptyModel(), casts, fingerprint: '' }),
  ),
);

describe('Editor', () => {
  test('loads the schema of the open database into the store and shows the canvas', async () => {
    const calls = installFakeApi({
      'schema.load': () => ({ model: fixtureModel, casts, fingerprint: 'abc' }),
    });
    const { container } = render(
      <Editor session={session} onDisconnect={vi.fn()} />,
    );
    expect(screen.getByText('Loading the schema…')).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('.react-flow')).toBeInTheDocument(),
    );
    expect(calls.filter((c) => c.channel === 'schema.load')).toHaveLength(1);
    expect(Object.keys(schemaStore.getState().baseline.tables)).toHaveLength(3);
    expect(schemaStore.getState()).toMatchObject({
      loadedFingerprint: 'abc',
      stale: false,
    });
    expect(screen.queryByText('Loading the schema…')).not.toBeInTheDocument();
  });

  test('says what went wrong when the schema cannot be loaded, in a toast that goes with the Editor, and still lets you leave', async () => {
    installFakeApi({
      'schema.load': () => {
        throw new Error('No database is open');
      },
    });
    const onDisconnect = vi.fn();
    const { unmount } = render(
      <Editor session={session} onDisconnect={onDisconnect} />,
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't load the schema: No database is open",
        { id: 'load-failed', duration: Infinity },
      ),
    );
    expect(
      screen.queryByRole('region', { hidden: true }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalled();
    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith('load-failed');
  });

  test('says which database is open, and that a password was not saved when it was not', async () => {
    installFakeApi({
      'schema.load': () => ({ model: emptyModel(), casts, fingerprint: 'f' }),
    });
    render(
      <Editor
        session={{
          ...session,
          saved: { connectionId: 'c', passwordNotSaved: true },
        }}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.getByText(/no keyring/)).toBeInTheDocument();
    await screen.findByText(/Connected to/);
  });
});
