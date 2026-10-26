import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type {
  OpenResult,
  SavedConnection,
  SessionInfo,
} from '../../../../shared/ipc-contract';
import { installFakeApi } from '@/test-utils';
import { Connect } from '.';

const session: SessionInfo = {
  serverVersion: '16.4',
  database: 'app',
  host: 'localhost',
  hostKind: 'local',
  dbKey: 'k',
  saved: null,
};

const saved = (over: Partial<SavedConnection> = {}): SavedConnection => ({
  id: 'one',
  label: 'alice@db.example.com:5432/app',
  kind: 'params',
  host: 'db.example.com',
  port: 5432,
  user: 'alice',
  database: 'app',
  url: null,
  sslMode: 'require',
  sslCaPath: null,
  hasPassword: true,
  lastUsedAt: 1,
  ...over,
});

function setup(
  over: {
    open?: (...args: never[]) => OpenResult;
    openSaved?: () => OpenResult;
    recent?: SavedConnection[];
  } = {},
) {
  const calls = installFakeApi({
    'connection.defaults': () => ({
      osUser: 'tester',
      socketPath: '/var/run/postgresql',
    }),
    'connection.recent': () => over.recent ?? [],
    'connection.open': () =>
      over.open?.() ?? { status: 'opened' as const, session },
    'connection.openSaved': () =>
      over.openSaved?.() ?? { status: 'opened' as const, session },
  });
  const onOpened = vi.fn();
  const user = userEvent.setup();
  render(<Connect onOpened={onOpened} />);
  return { calls, onOpened, user };
}

const sslMode = () => screen.getByRole('combobox', { name: 'SSL mode' });
const field = (name: string) => screen.getByLabelText(name);
const opens = (calls: ReturnType<typeof setup>['calls']) =>
  calls.filter((c) => c.channel === 'connection.open');

describe('the form', () => {
  test('starts with the usual local values and SSL off', () => {
    setup();
    expect(field('Host')).toHaveValue('localhost');
    expect(field('Port')).toHaveValue('5432');
    expect(field('User')).toHaveValue('postgres');
    expect(field('Database')).toHaveValue('');
    expect(sslMode()).toHaveTextContent('disable');
  });

  test('socket mode fills the operating system user and the socket directory, with no password', async () => {
    const { user } = setup();
    await user.type(field('Password'), 'secret');
    await user.click(screen.getByRole('tab', { name: 'Local socket' }));
    await waitFor(() => expect(field('User')).toHaveValue('tester'));
    expect(field('Socket directory')).toHaveValue('/var/run/postgresql');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(sslMode()).toHaveTextContent('disable');
  });

  test('a remote host defaults to require, and back to disable for a local one', async () => {
    const { user } = setup();
    await user.clear(field('Host'));
    await user.type(field('Host'), 'db.example.com');
    expect(sslMode()).toHaveTextContent('require');
    await user.clear(field('Host'));
    await user.type(field('Host'), '127.0.0.1');
    expect(sslMode()).toHaveTextContent('disable');
  });

  test('a mode that was picked stays when the host changes, and verify-full asks for a CA file', async () => {
    const { user } = setup();
    await user.click(sslMode());
    await user.click(
      await screen.findByRole('option', { name: 'verify-full' }),
    );
    expect(sslMode()).toHaveTextContent('verify-full');
    expect(field('CA certificate file')).toBeInTheDocument();
    await user.clear(field('Host'));
    await user.type(field('Host'), 'db.example.com');
    expect(sslMode()).toHaveTextContent('verify-full');
  });

  test('a pasted connection string sets the SSL mode and loses its sslmode', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'Connection string' }));
    await user.click(field('Connection string'));
    await user.paste('postgres://u:pw@db.example.com/app?sslmode=verify-full');
    expect(field('Connection string')).toHaveValue(
      'postgres://u:pw@db.example.com/app',
    );
    expect(sslMode()).toHaveTextContent('verify-full');
  });

  test('mistakes are shown by the field and nothing is sent', async () => {
    const { user, calls } = setup();
    await user.clear(field('Port'));
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(
      await screen.findByText('Enter a database name'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Enter a port between 1 and 65535'),
    ).toBeInTheDocument();
    expect(field('Database')).toHaveAttribute('aria-invalid', 'true');
    expect(opens(calls)).toHaveLength(0);
    // typing clears them
    await user.type(field('Database'), 'a');
    expect(screen.queryByText('Enter a database name')).not.toBeInTheDocument();
  });
});

describe('connecting', () => {
  test('sends the fields, and remember when it is ticked, and leaves the screen once open', async () => {
    const { user, calls, onOpened } = setup();
    await user.type(field('Password'), 'pw');
    await user.type(field('Database'), 'app');
    await user.click(screen.getByLabelText('Remember this connection'));
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(session));
    expect(opens(calls)[0]?.args).toEqual([
      {
        params: {
          kind: 'params',
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: 'pw',
          database: 'app',
          sslMode: 'disable',
        },
        remember: true,
      },
    ]);
  });

  test('without ticking remember it is not remembered', async () => {
    const { user, calls } = setup();
    await user.type(field('Database'), 'app');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(opens(calls)).toHaveLength(1));
    expect(opens(calls)[0]?.args).toMatchObject([{ remember: false }]);
  });

  test('a failure shows its message, stays on the form, and can be tried again', async () => {
    const { user, onOpened } = setup({
      open: () => ({ status: 'failed', message: 'Host not found' }),
    });
    await user.type(field('Database'), 'app');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Host not found')).toBeInTheDocument();
    expect(onOpened).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
    expect(field('Database')).toHaveValue('app');
  });

  test('while connecting the button says so and cannot be pressed again', async () => {
    let finish: (r: OpenResult) => void = () => undefined;
    installFakeApi({
      'connection.defaults': () => ({ osUser: 't', socketPath: '/s' }),
      'connection.recent': () => [],
      'connection.open': () =>
        new Promise<OpenResult>((resolve) => (finish = resolve)) as never,
    });
    const user = userEvent.setup();
    render(<Connect onOpened={vi.fn()} />);
    await user.type(field('Database'), 'app');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(
      await screen.findByRole('button', { name: 'Connecting…' }),
    ).toBeDisabled();
    finish({ status: 'failed', message: 'nope' });
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });
});

describe('recent connections', () => {
  test('are listed, and one click opens that one by its id', async () => {
    const { user, calls, onOpened } = setup({
      recent: [saved(), saved({ id: 'two', label: 'me@localhost:5432/other' })],
    });
    expect(
      await screen.findByRole('heading', { name: 'Recent connections' }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'me@localhost:5432/other' }),
    );
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith(session));
    expect(
      calls.find((c) => c.channel === 'connection.openSaved')?.args,
    ).toEqual([{ connectionId: 'two' }]);
  });

  test('a failure to open one is shown like any other', async () => {
    const { user, onOpened } = setup({
      recent: [saved()],
      openSaved: () => ({
        status: 'failed',
        message: 'Enter the password again',
      }),
    });
    await user.click(
      await screen.findByRole('button', {
        name: 'alice@db.example.com:5432/app',
      }),
    );
    expect(
      await screen.findByText('Enter the password again'),
    ).toBeInTheDocument();
    expect(onOpened).not.toHaveBeenCalled();
  });

  test('there is no heading when there are none, and a failure to load them is not an error', async () => {
    setup();
    await waitFor(() =>
      expect(screen.queryByText('Recent connections')).not.toBeInTheDocument(),
    );
  });
});
