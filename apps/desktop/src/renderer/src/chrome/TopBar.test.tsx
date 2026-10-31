import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { TopBar } from './TopBar';

const casts = { categories: {}, domains: {}, casts: {} };
const session = {
  serverVersion: '16.4',
  database: 'app',
  host: 'db.example.com',
  hostKind: 'remote' as const,
  dbKey: 'k',
  saved: null,
};
const setup = (ready = true, onDisconnect = vi.fn()) => {
  render(
    <TopBar session={session} ready={ready} onDisconnect={onDisconnect} />,
  );
  return onDisconnect;
};
const generate = () => screen.getByRole('button', { name: 'Generate SQL' });
/** What holds Generate SQL, which is on what it sits in: a disabled button has no tooltip of its own. */
const why = () => generate().parentElement!.getAttribute('title');

beforeEach(() =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  ),
);
afterEach(() =>
  act(() => {
    uiStore.getState().setSqlPanelOpen(false);
    uiStore.getState().setConnectionLost(null);
    uiStore.getState().setReloadAsked(false);
  }),
);

describe('TopBar', () => {
  test('says which database is open, and on what', () => {
    setup();
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(
      screen.getByText(/on db\.example\.com · Postgres 16\.4/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
  });

  test('Generate SQL is off with no changes, and says why', () => {
    setup();
    expect(generate()).toBeDisabled();
    expect(why()).toMatch(/no changes/);
  });

  test('Generate SQL is off while the schema is loading', () => {
    setup(false);
    expect(generate()).toBeDisabled();
    expect(why()).toMatch(/loading/);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Auto-arrange' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  test('Generate SQL is on once there is a change, and opens the SQL panel', async () => {
    act(() => schemaStore.getState().renameTable('t:10', 'people'));
    setup();
    expect(generate()).toBeEnabled();
    expect(why()).toBeNull();
    await userEvent.click(generate());
    expect(uiStore.getState().sqlPanelOpen).toBe(true);
  });

  test('Generate SQL is off while an edit has an error, and names it', () => {
    act(() => schemaStore.getState().renameTable('t:10', ''));
    setup();
    expect(generate()).toBeDisabled();
    expect(why()).toMatch(/Fix this first: .*empty/);
  });

  test('Generate SQL is off while the schema is stale or the connection is lost', () => {
    act(() => {
      schemaStore.getState().renameTable('t:10', 'people');
      schemaStore.getState().markStale();
    });
    setup();
    expect(generate()).toBeDisabled();
    expect(why()).toMatch(/changed outside pgsketch/);
    act(() => {
      schemaStore.getState().clearStale();
      uiStore.getState().setConnectionLost('gone');
    });
    expect(generate()).toBeDisabled();
    expect(why()).toMatch(/connection .* lost/);
  });

  test('counts the changes, and the risky ones by kind', () => {
    setup();
    expect(screen.getByText('0 changes')).toBeInTheDocument();
    act(() => {
      schemaStore.getState().renameTable('t:10', 'people');
      schemaStore.getState().removeColumn('c:10:2');
    });
    expect(screen.getByText('2 changes')).toBeInTheDocument();
    expect(screen.getByText(/· 1 destructive/)).toBeInTheDocument();
  });

  test('Reload reloads at once with no edits, and asks with some', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(uiStore.getState().reloadAsked).toBe(false);
  });

  test('Reload asks when there are edits to lose', async () => {
    act(() => schemaStore.getState().renameTable('t:10', 'people'));
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(uiStore.getState().reloadAsked).toBe(true);
  });

  test('Disconnect leaves', async () => {
    const onDisconnect = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  test('says that a password was not saved, when it was not', () => {
    render(
      <TopBar
        session={{
          ...session,
          saved: { connectionId: 'c', passwordNotSaved: true },
        }}
        ready
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByText(/no keyring/)).toBeInTheDocument();
  });
});
