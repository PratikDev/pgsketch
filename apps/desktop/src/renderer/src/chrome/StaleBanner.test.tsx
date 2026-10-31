import { act, render, waitFor } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { installFakeApi } from '@/test-utils';
import { StaleBanner } from './StaleBanner';

// toasts are drawn by the Toaster, which these tests don't mount: they check what was asked of `toast`
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

const casts = { categories: {}, domains: {}, casts: {} };
const session = {
  serverVersion: '16',
  database: 'app',
  host: 'h',
  hostKind: 'local' as const,
  dbKey: 'k',
  saved: null,
};

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  vi.mocked(toast.dismiss).mockClear();
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f0' }),
  );
});
afterEach(() =>
  act(() => {
    uiStore.getState().setConnectionLost(null);
    uiStore.getState().setReloadAsked(false);
  }),
);

/** What the notice for this id was shown with, and a way to press its button. */
const notice = (kind: 'warning' | 'error', id: string) => {
  const call = vi
    .mocked(toast[kind])
    .mock.calls.filter(([, options]) => options?.id === id)
    .at(-1);
  if (!call) throw new Error(`no ${kind} toast ${id}`);
  const [message, options] = call;
  const action = options?.action;
  return {
    message,
    options: options ?? {},
    press: () => {
      const event = { preventDefault: vi.fn() };
      if (
        typeof action !== 'object' ||
        action === null ||
        !('onClick' in action)
      )
        throw new Error('the toast has no button');
      action.onClick(event as unknown as MouseEvent<HTMLButtonElement>);
      return event;
    },
  };
};

describe('StaleBanner: the schema is stale', () => {
  test('shows nothing while the schema can be trusted', () => {
    render(<StaleBanner onReconnected={vi.fn()} />);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('says so in a toast that stays and cannot be swiped away, whose button is Reload', () => {
    act(() => schemaStore.getState().markStale());
    render(<StaleBanner onReconnected={vi.fn()} />);
    const n = notice('warning', 'schema-stale');
    expect(n.message).toBe('The database schema changed outside pgsketch.');
    expect(n.options).toMatchObject({
      duration: Infinity,
      dismissible: false,
      action: { label: 'Reload' },
    });
  });

  test('Reload asks the question, and does not close the toast', () => {
    act(() => {
      schemaStore.getState().renameTable('t:10', 'people');
      schemaStore.getState().markStale();
    });
    render(<StaleBanner onReconnected={vi.fn()} />);
    expect(uiStore.getState().reloadAsked).toBe(false);
    const press = notice('warning', 'schema-stale').press();
    // the toast stays: Cancel in the dialog leaves it as it was
    expect(press.preventDefault).toHaveBeenCalled();
    expect(uiStore.getState().reloadAsked).toBe(true);
    expect(toast.dismiss).not.toHaveBeenCalledWith('schema-stale');
  });

  test('goes by itself when the schema is no longer stale, and with the Editor', () => {
    act(() => schemaStore.getState().markStale());
    const { unmount } = render(<StaleBanner onReconnected={vi.fn()} />);
    act(() => schemaStore.getState().clearStale());
    expect(toast.dismiss).toHaveBeenCalledWith('schema-stale');
    vi.mocked(toast.dismiss).mockClear();
    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith('schema-stale');
    expect(toast.dismiss).toHaveBeenCalledWith('connection-lost');
  });
});

describe('StaleBanner: the connection was lost', () => {
  test('says so, with why, and that the edits are kept, in a toast that stays and has Reconnect', () => {
    act(() => uiStore.getState().setConnectionLost('terminating connection'));
    render(<StaleBanner onReconnected={vi.fn()} />);
    const n = notice('error', 'connection-lost');
    expect(n.message).toBe(
      'The connection to the database was lost (terminating connection). Your edits are kept.',
    );
    expect(n.options).toMatchObject({
      duration: Infinity,
      dismissible: false,
      action: { label: 'Reconnect' },
    });
  });

  test('Reconnect opens the database again, takes the toast away, and lets the handler look again', async () => {
    installFakeApi({
      'connection.reconnect': () => ({ status: 'opened', session }),
    });
    const onReconnected = vi.fn();
    act(() => uiStore.getState().setConnectionLost('gone'));
    render(<StaleBanner onReconnected={onReconnected} />);
    const press = notice('error', 'connection-lost').press();
    expect(press.preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(onReconnected).toHaveBeenCalledOnce());
    expect(uiStore.getState().connectionLost).toBeNull();
    expect(toast.dismiss).toHaveBeenCalledWith('connection-lost');
  });

  test('says on its button that it is reconnecting, and a second press does not start a second one', async () => {
    let finish: (r: unknown) => void = () => undefined;
    const calls = installFakeApi({
      'connection.reconnect': () =>
        new Promise((resolve) => (finish = resolve)) as never,
    });
    act(() => uiStore.getState().setConnectionLost('gone'));
    render(<StaleBanner onReconnected={vi.fn()} />);
    act(() => void notice('error', 'connection-lost').press());
    await waitFor(() =>
      expect(notice('error', 'connection-lost').options.action).toMatchObject({
        label: 'Reconnecting…',
      }),
    );
    act(() => void notice('error', 'connection-lost').press());
    expect(
      calls.filter((c) => c.channel === 'connection.reconnect'),
    ).toHaveLength(1);
    finish({ status: 'failed', message: 'Connection refused' });
    await waitFor(() =>
      expect(notice('error', 'connection-lost').options.action).toMatchObject({
        label: 'Reconnect',
      }),
    );
  });

  test('a reconnect that fails says why, and the notice stays for another try', async () => {
    installFakeApi({
      'connection.reconnect': () => ({
        status: 'failed',
        message: 'Connection refused',
      }),
    });
    act(() => uiStore.getState().setConnectionLost('gone'));
    const onReconnected = vi.fn();
    render(<StaleBanner onReconnected={onReconnected} />);
    act(() => void notice('error', 'connection-lost').press());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Connection refused'),
    );
    expect(onReconnected).not.toHaveBeenCalled();
    expect(uiStore.getState().connectionLost).toBe('gone');
    expect(toast.dismiss).not.toHaveBeenCalledWith('connection-lost');
  });
});
