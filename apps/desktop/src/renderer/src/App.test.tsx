import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import App from '@/App';
import { emptyModel } from '@/stores/schema/core';
import { installFakeApi } from '@/test-utils';

test('shows the Connect screen first, and the Editor once a database is open', async () => {
  const calls = installFakeApi({
    'connection.defaults': () => ({
      osUser: 'tester',
      socketPath: '/var/run/postgresql',
    }),
    'connection.recent': () => [],
    'connection.open': () => ({
      status: 'opened',
      session: {
        serverVersion: '16.4',
        database: 'app',
        host: 'localhost',
        hostKind: 'local',
        dbKey: 'k',
        saved: { connectionId: 'c', passwordNotSaved: true },
      },
    }),
    'connection.close': () => undefined,
    'schema.load': () => ({
      model: emptyModel(),
      casts: { categories: {}, domains: {}, casts: {} },
      fingerprint: 'f',
    }),
  });
  const user = userEvent.setup();
  render(<App />);

  expect(
    screen.getByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Editor' }),
  ).not.toBeInTheDocument();

  await user.type(screen.getByLabelText('Database'), 'app');
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  expect(
    await screen.findByRole('heading', { name: 'Editor' }),
  ).toBeInTheDocument();
  expect(screen.getByText('app')).toBeInTheDocument();
  expect(screen.getByText(/no keyring/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(
    await screen.findByRole('heading', { name: 'Connect to Postgres' }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(calls.some((c) => c.channel === 'connection.close')).toBe(true),
  );
});
