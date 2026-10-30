import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';
import { openAppDb } from './db';
import { createDraftsRepo } from './drafts';

let db: DatabaseSync;
const repo = () => createDraftsRepo(db);
const draft = (n: number) => ({
  fingerprint: `fp${n}`,
  desiredJson: JSON.stringify({ edit: n }),
});

beforeEach(() => {
  db = openAppDb(':memory:');
});

describe('the drafts repository', () => {
  test('gives back what was saved for a database, and nothing for one it has not seen', () => {
    repo().put('k1', draft(1));
    expect(repo().get('k1')).toEqual(draft(1));
    expect(repo().get('other')).toBeNull();
  });

  test('keeps each database apart, a hash of an unsaved connection like any other', () => {
    const hash = 'b1946ac92492d2347c6235b4d2611184';
    repo().put(hash, draft(1));
    repo().put('saved-id:app', draft(2));
    expect(repo().get(hash)).toEqual(draft(1));
    expect(repo().get('saved-id:app')).toEqual(draft(2));
  });

  test('saving again replaces the draft, and keeps one row', () => {
    repo().put('k', draft(1));
    repo().put('k', draft(2));
    expect(repo().get('k')).toEqual(draft(2));
    expect(db.prepare('SELECT count(*) AS n FROM drafts').get()).toEqual({
      n: 1,
    });
  });

  test('clearing forgets that database only, and clearing twice is fine', () => {
    repo().put('k', draft(1));
    repo().put('other', draft(2));
    repo().clear('k');
    repo().clear('k');
    expect(repo().get('k')).toBeNull();
    expect(repo().get('other')).toEqual(draft(2));
  });

  test('keeps the text exactly, whatever is in it', () => {
    const odd = {
      fingerprint: 'f',
      desiredJson: '{"name":"it\'s \\"q\\" 100% _ \\\\ ✓"}',
    };
    repo().put('k', odd);
    expect(repo().get('k')).toEqual(odd);
  });

  test("forgetting a connection deletes the drafts of its databases, and no other's, even when its id has a wildcard in it", () => {
    repo().put('c_1:app', draft(1));
    repo().put('c_1:other', draft(2));
    repo().put('cX1:app', draft(3));
    repo().put('c%:app', draft(4));
    repo().put('unsaved', draft(5));
    repo().removeForConnection('c_1');
    expect(repo().get('c_1:app')).toBeNull();
    expect(repo().get('c_1:other')).toBeNull();
    expect(repo().get('cX1:app')).toEqual(draft(3));
    expect(repo().get('c%:app')).toEqual(draft(4));
    expect(repo().get('unsaved')).toEqual(draft(5));
  });
});
