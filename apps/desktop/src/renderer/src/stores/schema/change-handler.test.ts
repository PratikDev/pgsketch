import type { Introspection, SchemaModel } from '@pgsketch/core';
import { act } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fixtureModel } from '@/test-model';
import { uiStore } from '../ui';
import { createChangeHandler } from './change-handler';
import { schemaStore } from '.';

const casts = { categories: {}, domains: {}, casts: {} };
const loadedAs = (model: SchemaModel, fingerprint: string): Introspection => ({
  model,
  casts,
  fingerprint,
});
const changed = (change: (m: SchemaModel) => void, fingerprint: string) => {
  const model = structuredClone(fixtureModel);
  change(model);
  return loadedAs(model, fingerprint);
};
const state = () => schemaStore.getState();

/** A handler whose database is whatever `database.now` is. */
function setup() {
  const database = { now: loadedAs(fixtureModel, 'fp-0') };
  const onApplied = vi.fn();
  const load = vi.fn(async () => database.now);
  const handler = createChangeHandler({ load, onApplied });
  return { database, onApplied, load, handler };
}

beforeEach(() => {
  uiStore.getState().cancelEditing();
  act(() => state().load(loadedAs(fixtureModel, 'fp-0')));
});

describe('the change handler', () => {
  test('does nothing when the database is as it was loaded, and a stale schema is fine again', async () => {
    const { handler, onApplied } = setup();
    act(() => state().renameTable('t:10', 'people'));
    act(() => state().markStale());
    await handler();
    expect(state().stale).toBe(false);
    expect(state().desired.tables['t:10']!.name).toBe('people');
    expect(onApplied).not.toHaveBeenCalled();
  });

  test('takes a changed schema as it is when there are no edits', async () => {
    const { handler, database, onApplied } = setup();
    database.now = changed(
      (m) => void (m.columns['c:10:2']!.name = 'state'),
      'fp-1',
    );
    await handler();
    expect(state().baseline.columns['c:10:2']!.name).toBe('state');
    expect(state().desired.columns['c:10:2']!.name).toBe('state');
    expect(state()).toMatchObject({ loadedFingerprint: 'fp-1', stale: false });
    expect(onApplied).not.toHaveBeenCalled();
  });

  test('takes it, and says the SQL was run, when it has what the edits asked for', async () => {
    const { handler, database, onApplied } = setup();
    act(() => state().renameColumn('c:10:2', 'state'));
    database.now = changed(
      (m) => void (m.columns['c:10:2']!.name = 'state'),
      'fp-1',
    );
    await handler();
    expect(state()).toMatchObject({ loadedFingerprint: 'fp-1', stale: false });
    expect(state().baseline.columns['c:10:2']!.name).toBe('state');
    expect(onApplied).toHaveBeenCalledOnce();
    // no edits are left: what was asked for is in the database
    expect(state().desired).toEqual(state().baseline);
  });

  test('a table made in the editor and now made by the database is told as the same table, under its new id', async () => {
    const { handler, database, onApplied } = setup();
    let pending = '';
    act(() => void (pending = state().addTable('s:1')));
    database.now = changed((m) => {
      m.tables['t:900'] = {
        id: 't:900',
        schemaId: 's:1',
        name: 'new_table',
        comment: null,
      };
      m.columns['c:900:1'] = {
        id: 'c:900:1',
        tableId: 't:900',
        name: 'id',
        position: 1,
        type: { name: 'bigint', isArray: false },
        notNull: true,
        default: null,
        identity: 'always',
        comment: null,
      };
      m.constraints['k:900'] = {
        id: 'k:900',
        tableId: 't:900',
        kind: 'pk',
        name: 'new_table_pkey',
        columnIds: ['c:900:1'],
      };
    }, 'fp-1');
    await handler();
    expect(onApplied).toHaveBeenCalledExactlyOnceWith({ [pending]: 't:900' });
    expect(state().stale).toBe(false);
  });

  test('goes stale, keeping the edits, when the database changed to something they do not fit', async () => {
    const { handler, database, onApplied } = setup();
    act(() => state().renameColumn('c:10:2', 'state'));
    database.now = changed(
      (m) => void (m.tables['t:30']!.name = 'logs'),
      'fp-1',
    );
    await handler();
    expect(state().stale).toBe(true);
    expect(state().desired.columns['c:10:2']!.name).toBe('state');
    expect(state().baseline.tables['t:30']!.name).toBe('events');
    expect(state().loadedFingerprint).toBe('fp-0');
    expect(onApplied).not.toHaveBeenCalled();
  });

  test('half of the SQL goes stale, and the other half, run later, brings it back', async () => {
    const { handler, database, onApplied } = setup();
    act(() => {
      state().renameColumn('c:10:2', 'state');
      state().renameTable('t:30', 'logs');
    });
    database.now = changed(
      (m) => void (m.columns['c:10:2']!.name = 'state'),
      'fp-1',
    );
    await handler();
    expect(state().stale).toBe(true);
    database.now = changed((m) => {
      m.columns['c:10:2']!.name = 'state';
      m.tables['t:30']!.name = 'logs';
    }, 'fp-2');
    await handler();
    expect(state()).toMatchObject({ stale: false, loadedFingerprint: 'fp-2' });
    expect(onApplied).toHaveBeenCalledOnce();
  });

  test('goes stale when the database cannot be read, since what is shown can no longer be trusted', async () => {
    const { handler, load } = setup();
    load.mockRejectedValueOnce(new Error('connection lost'));
    await handler();
    expect(state().stale).toBe(true);
  });

  test('an edit made while the database was being read is kept, and the schema goes stale instead of taking the new one', async () => {
    const { handler, database, load, onApplied } = setup();
    let finish: (i: Introspection) => void = () => undefined;
    load.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const running = handler();
    act(() => state().renameTable('t:10', 'people'));
    finish(changed((m) => void (m.tables['t:30']!.name = 'logs'), 'fp-1'));
    await running;
    expect(state().stale).toBe(true);
    expect(state().desired.tables['t:10']!.name).toBe('people');
    expect(state().baseline.tables['t:30']!.name).toBe('events');
    expect(onApplied).not.toHaveBeenCalled();
    void database;
  });

  test('an input left open waits for the closing, and the text typed in it is kept', async () => {
    const { handler, database, onApplied } = setup();
    act(() => state().renameColumn('c:10:2', 'state'));
    database.now = changed(
      (m) => void (m.columns['c:10:2']!.name = 'state'),
      'fp-1',
    );
    act(() => uiStore.getState().startEditing('c:10:1:name'));
    const running = handler();
    await new Promise((r) => setTimeout(r, 20));
    // nothing has been taken while the input is open
    expect(state().loadedFingerprint).toBe('fp-0');
    expect(onApplied).not.toHaveBeenCalled();
    // the typed text is committed: it is one more edit, and the database does not have it
    act(() => state().renameColumn('c:10:1', 'ident'));
    act(() => uiStore.getState().stopEditing('c:10:1:name'));
    await running;
    expect(state().stale).toBe(true);
    expect(state().desired.columns['c:10:1']!.name).toBe('ident');
    expect(onApplied).not.toHaveBeenCalled();
  });

  test('an input closed with nothing typed lets the schema be taken, as it was going to be', async () => {
    const { handler, database, onApplied } = setup();
    act(() => state().renameColumn('c:10:2', 'state'));
    database.now = changed(
      (m) => void (m.columns['c:10:2']!.name = 'state'),
      'fp-1',
    );
    act(() => uiStore.getState().startEditing('c:10:1:name'));
    const running = handler();
    act(() => uiStore.getState().stopEditing('c:10:1:name'));
    await running;
    expect(state()).toMatchObject({ stale: false, loadedFingerprint: 'fp-1' });
    expect(onApplied).toHaveBeenCalledOnce();
  });

  test('a change that comes in while one is being looked at makes it look once more, and no two run at once', async () => {
    const { handler, database, load } = setup();
    let finish: (i: Introspection) => void = () => undefined;
    let running = 0;
    let most = 0;
    load.mockImplementationOnce(() => {
      most = Math.max(most, ++running);
      return new Promise(
        (resolve) =>
          (finish = (i) => {
            running--;
            resolve(i);
          }),
      );
    });
    const first = handler();
    const second = handler();
    const third = handler();
    database.now = changed(
      (m) => void (m.tables['t:30']!.name = 'logs'),
      'fp-1',
    );
    finish(database.now);
    await Promise.all([first, second, third]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
    expect(state().baseline.tables['t:30']!.name).toBe('logs');
  });
});
