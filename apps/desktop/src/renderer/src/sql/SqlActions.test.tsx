import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from 'sonner';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { installFakeApi, testSession } from '@/test-utils';
import type {
  SessionInfo,
  StatementResult,
  ValidateResult,
} from '../../../shared/ipc-contract';
import { SqlPanel } from './SqlPanel';

const casts = { categories: {}, domains: {}, casts: {} };
const sqlText = () =>
  [...document.querySelectorAll('.cm-line')]
    .map((l) => l.textContent)
    .join('\n');

/** The panel for a rename, with the database as loaded, and whatever `sql.*` answers are given. */
async function setup(
  over: {
    session?: Partial<SessionInfo>;
    validate?: () => ValidateResult;
    save?: () => { status: 'saved'; path: string } | { status: 'cancelled' };
    fingerprint?: string;
    onSchemaChanged?: () => Promise<void>;
  } = {},
) {
  const calls = installFakeApi({
    'schema.fingerprint': () => over.fingerprint ?? 'f0',
    'schema.casts': () => casts,
    'sql.validate': over.validate ?? (() => ({ status: 'done', results: [] })),
    'sql.save': over.save ?? (() => ({ status: 'cancelled' })),
  });
  render(
    <SqlPanel
      session={testSession(over.session)}
      onSchemaChanged={over.onSchemaChanged ?? (async () => undefined)}
    />,
  );
  await waitFor(() => expect(sqlText()).toMatch(/"people"/));
  return {
    channel: (c: string) => calls.filter((x) => x.channel === c),
  };
}

const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);

beforeEach(() => {
  act(() => {
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f0' });
    schemaStore.getState().renameTable('t:10', 'people');
  });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  writeText.mockClear();
});
afterEach(() => {
  act(() => uiStore.getState().setSqlPanelOpen(false));
  vi.restoreAllMocks();
});

const button = (name: string) => screen.getByRole('button', { name });

describe('Copy', () => {
  test('puts the whole SQL on the clipboard and says so for a moment', async () => {
    await setup();
    await userEvent.click(button('Copy'));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toBe(sqlText());
    expect(button('Copied')).toBeInTheDocument();
  });

  test('a clipboard that refuses is an error toast', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const error = vi.spyOn(toast, 'error');
    await setup();
    await userEvent.click(button('Copy'));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Couldn't copy the SQL: denied"),
    );
  });
});

describe('Save', () => {
  test('sends the SQL with a file name made of the time, and tells where it went', async () => {
    const success = vi.spyOn(toast, 'success');
    const { channel } = await setup({
      save: () => ({ status: 'saved', path: '/work/a.sql' }),
    });
    await userEvent.click(button('Save'));
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith('Saved /work/a.sql'),
    );
    expect(channel('sql.save')[0]?.args).toEqual([
      {
        text: sqlText(),
        suggestedName: expect.stringMatching(/^\d{8}_\d{6}_pgsketch\.sql$/),
      },
    ]);
  });

  test('a cancelled dialog says nothing', async () => {
    const success = vi.spyOn(toast, 'success');
    const error = vi.spyOn(toast, 'error');
    const { channel } = await setup();
    await userEvent.click(button('Save'));
    await waitFor(() => expect(channel('sql.save')).toHaveLength(1));
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

const failedAt: StatementResult[] = [
  {
    status: 'failed',
    message: 'column "x" contains null values',
    code: '23502',
  },
];

describe('Validate', () => {
  test('checks the database, runs the statements as rendered, and shows each result next to them', async () => {
    const { channel } = await setup({
      validate: () => ({
        status: 'done',
        results: [{ status: 'passed' }],
      }),
    });
    await userEvent.click(button('Validate'));
    const results = await screen.findByRole('region', {
      name: 'Validation results',
    });
    expect(within(results).getByRole('status')).toHaveTextContent(
      'All 1 statement passed. Nothing was kept.',
    );
    expect(within(results).getByLabelText('Passed')).toBeInTheDocument();
    expect(channel('schema.fingerprint')).toHaveLength(2); // generating, then Validate
    expect(channel('sql.validate')[0]?.args).toEqual([
      {
        statements: [expect.stringMatching(/RENAME TO "people"/)],
        fingerprint: 'f0',
      },
    ]);
  });

  test('shows the failure with its error and code, and what was not run', async () => {
    await setup({
      validate: () => ({
        status: 'done',
        results: [...failedAt, { status: 'not-run' }],
      }),
    });
    await userEvent.click(button('Validate'));
    const results = await screen.findByRole('region', {
      name: 'Validation results',
    });
    expect(within(results).getByRole('status')).toHaveTextContent(
      'Statement 1 of 2 failed. Nothing was kept.',
    );
    expect(within(results).getByRole('alert')).toHaveTextContent(
      'column "x" contains null values (23502)',
    );
    expect(within(results).getByLabelText('Not run')).toBeInTheDocument();
  });

  test('the results go when the SQL changes', async () => {
    await setup({
      validate: () => ({ status: 'done', results: [{ status: 'passed' }] }),
    });
    await userEvent.click(button('Validate'));
    await screen.findByRole('region', { name: 'Validation results' });
    act(() => schemaStore.getState().renameTable('t:10', 'persons'));
    await waitFor(() => expect(sqlText()).toMatch(/"persons"/));
    expect(
      screen.queryByRole('region', { name: 'Validation results' }),
    ).toBeNull();
  });

  test('when the database changed since the SQL was made it looks at the change and runs nothing', async () => {
    const looked = vi.fn(async () => undefined);
    const { channel } = await setup({ onSchemaChanged: looked });
    // the database moves on after the SQL was made
    installFakeApi({
      'schema.fingerprint': () => 'f1',
      'schema.casts': () => casts,
      'sql.validate': () => ({ status: 'done', results: [] }),
    });
    await userEvent.click(button('Validate'));
    await waitFor(() => expect(looked).toHaveBeenCalledOnce());
    expect(channel('sql.validate')).toHaveLength(0);
    expect(button('Validate')).toBeEnabled();
  });

  test('a server that finds it changed meanwhile has the change looked at, with no results shown', async () => {
    const looked = vi.fn(async () => undefined);
    await setup({
      validate: () => ({ status: 'stale' }),
      onSchemaChanged: looked,
    });
    await userEvent.click(button('Validate'));
    await waitFor(() => expect(looked).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole('region', { name: 'Validation results' }),
    ).toBeNull();
  });

  test('a local server is not asked about; a remote one asks first and runs only on a yes', async () => {
    const { channel } = await setup({
      session: { host: 'db.example.com', hostKind: 'remote' },
    });
    await userEvent.click(button('Validate'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Validate on db.example.com?');
    expect(channel('sql.validate')).toHaveLength(0);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(channel('sql.validate')).toHaveLength(0);

    await userEvent.click(button('Validate'));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Validate',
      }),
    );
    await waitFor(() => expect(channel('sql.validate')).toHaveLength(1));
  });

  test('a socket is local: no question', async () => {
    const { channel } = await setup({
      session: { host: '/var/run/postgresql', hostKind: 'socket' },
    });
    await userEvent.click(button('Validate'));
    await waitFor(() => expect(channel('sql.validate')).toHaveLength(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a run that throws is an error toast and Validate works again', async () => {
    const error = vi.spyOn(toast, 'error');
    await setup({
      validate: () => {
        throw new Error('timed out');
      },
    });
    await userEvent.click(button('Validate'));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "Couldn't validate the SQL: timed out",
      ),
    );
    expect(button('Validate')).toBeEnabled();
  });
});
