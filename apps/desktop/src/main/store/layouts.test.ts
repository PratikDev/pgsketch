import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';
import { openAppDb } from './db';
import { createLayoutsRepo } from './layouts';

let db: DatabaseSync;
const repo = () => createLayoutsRepo(db);

beforeEach(() => {
  db = openAppDb(':memory:');
});

describe('the layouts repository', () => {
  test('gives back what was saved for a database, and nothing for one it has not seen', () => {
    repo().put('k1', { 't:1': { x: 10, y: -20.5 }, 't:2': { x: 0, y: 300 } });
    expect(repo().get('k1')).toEqual({
      't:1': { x: 10, y: -20.5 },
      't:2': { x: 0, y: 300 },
    });
    expect(repo().get('other')).toEqual({});
  });

  test('keeps each database apart', () => {
    repo().put('a', { 't:1': { x: 1, y: 1 } });
    repo().put('b', { 't:1': { x: 2, y: 2 } });
    expect(repo().get('a')['t:1']).toEqual({ x: 1, y: 1 });
    expect(repo().get('b')['t:1']).toEqual({ x: 2, y: 2 });
  });

  test('saving replaces what was there, rather than adding to it', () => {
    repo().put('k', { 't:1': { x: 1, y: 1 }, 't:2': { x: 2, y: 2 } });
    repo().put('k', { 't:2': { x: 5, y: 5 } });
    expect(repo().get('k')).toEqual({ 't:2': { x: 5, y: 5 } });
    repo().put('k', {});
    expect(repo().get('k')).toEqual({});
  });

  test('saving is all or nothing', () => {
    repo().put('k', { 't:1': { x: 1, y: 1 } });
    expect(() =>
      repo().put('k', {
        't:2': { x: Number.NaN, y: 1 },
        't:3': { x: 3, y: 3 },
      }),
    ).toThrow();
    expect(repo().get('k')).toEqual({ 't:1': { x: 1, y: 1 } });
  });

  test('pruning forgets the tables that are not kept, only for that database', () => {
    repo().put('k', {
      't:1': { x: 1, y: 1 },
      't:2': { x: 2, y: 2 },
      't:3': { x: 3, y: 3 },
    });
    repo().put('other', { 't:2': { x: 9, y: 9 } });
    repo().prune('k', ['t:1', 't:3', 't:unknown']);
    expect(Object.keys(repo().get('k')).sort()).toEqual(['t:1', 't:3']);
    expect(repo().get('other')).toEqual({ 't:2': { x: 9, y: 9 } });
    repo().prune('k', []);
    expect(repo().get('k')).toEqual({});
  });

  test('ids are values, whatever they hold', () => {
    const odd = `x'); DROP TABLE layouts; --`;
    repo().put(odd, { [odd]: { x: 1, y: 2 } });
    repo().prune(odd, [odd]);
    expect(repo().get(odd)).toEqual({ [odd]: { x: 1, y: 2 } });
  });

  test('forgetting a connection removes the layouts of its databases, and no others', () => {
    repo().put('abc:app', { 't:1': { x: 1, y: 1 } });
    repo().put('abc:other', { 't:1': { x: 1, y: 1 } });
    repo().put('abcd:app', { 't:1': { x: 1, y: 1 } });
    repo().put('abc', { 't:1': { x: 1, y: 1 } });
    repo().put('hashed0f', { 't:1': { x: 1, y: 1 } });
    repo().removeForConnection('abc');
    expect(repo().get('abc:app')).toEqual({});
    expect(repo().get('abc:other')).toEqual({});
    expect(repo().get('abcd:app')).not.toEqual({});
    expect(repo().get('abc')).not.toEqual({});
    expect(repo().get('hashed0f')).not.toEqual({});
  });

  test('an id with wildcards in it matches only itself', () => {
    repo().put('a%:db', { 't:1': { x: 1, y: 1 } });
    repo().put('abc:db', { 't:1': { x: 1, y: 1 } });
    repo().removeForConnection('a%');
    expect(repo().get('a%:db')).toEqual({});
    expect(repo().get('abc:db')).not.toEqual({});
  });
});
