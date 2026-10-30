import { act } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { fixtureModel } from '@/test-model';
import { handleId } from './edges';
import { columnOfHandle, connectColumns } from './connect';

// toasts are drawn by the Toaster, which these tests don't mount
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const casts = { categories: {}, domains: {}, casts: {} };
beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  );
});
const keys = () =>
  Object.values(schemaStore.getState().desired.constraints).filter(
    (c) => c.kind === 'fk',
  );

describe('columnOfHandle', () => {
  test('is the column of any of the four handles of a row, however its id is written', () => {
    for (const side of ['left', 'right'] as const)
      for (const role of ['source', 'target'] as const) {
        expect(columnOfHandle(handleId('c:10:1', side, role))).toBe('c:10:1');
        expect(columnOfHandle(handleId('9f8-uuid', side, role))).toBe(
          '9f8-uuid',
        );
      }
  });

  test('is nothing for what is not a handle of a row', () => {
    for (const handle of [null, undefined, '', 'in', 'c:1:middle']) {
      expect(columnOfHandle(handle)).toBeNull();
    }
  });
});

describe('connectColumns', () => {
  // c:20:2 is invoices.user_id (bigint); c:10:1 is users.id, the key of users
  test('makes a foreign key from the first column to the second, in another table', () => {
    connectColumns('c:20:2', 'c:10:1');
    expect(keys()).toHaveLength(2);
    expect(keys().at(-1)).toMatchObject({
      tableId: 't:20',
      columnIds: ['c:20:2'],
      refTableId: 't:10',
      refColumnIds: ['c:10:1'],
      onDelete: 'no action',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('can start and end in the same table: a foreign key to itself', () => {
    let from = '';
    act(() => {
      from = schemaStore.getState().addColumn('t:10');
      schemaStore
        .getState()
        .setColumnType(from, { name: 'int8', isArray: false }); // as users.id is in the fixture
    });
    connectColumns(from, 'c:10:1');
    expect(keys().at(-1)).toMatchObject({
      tableId: 't:10',
      refTableId: 't:10',
      columnIds: [from],
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('makes nothing, and says why, when the other column is not a key', () => {
    connectColumns('c:20:2', 'c:10:2');
    expect(keys()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  test('makes nothing, and says why, when the types do not match', () => {
    connectColumns('c:20:3', 'c:10:1'); // numeric to bigint
    expect(keys()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  test('ignores a column that is not there', () => {
    connectColumns('nope', 'c:10:1');
    expect(keys()).toHaveLength(1);
  });
});
