import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { createSchemaStore } from '.';

const casts = { categories: {}, domains: {}, casts: {} };

describe('the core slice', () => {
  test('starts empty, not stale and at version 0', () => {
    const s = createSchemaStore().getState();
    expect(s.baseline.tables).toEqual({});
    expect(s.desired.tables).toEqual({});
    expect(s.casts).toBeNull();
    expect(s.loadedFingerprint).toBeNull();
    expect([s.stale, s.version]).toEqual([false, 0]);
  });

  test('load sets the baseline, a separate copy as desired, the cast data and the fingerprint', () => {
    const store = createSchemaStore();
    store.getState().load({ model: fixtureModel, casts, fingerprint: 'f1' });
    const s = store.getState();
    expect(s.baseline).toBe(fixtureModel);
    expect(s.desired).toEqual(fixtureModel);
    expect(s.desired).not.toBe(s.baseline);
    expect(s.casts).toBe(casts);
    expect(s.loadedFingerprint).toBe('f1');
  });

  test('loading again drops the edits, the stale flag and the version', () => {
    const store = createSchemaStore();
    const { load, edit, markStale } = store.getState();
    load({ model: fixtureModel, casts, fingerprint: 'f1' });
    edit((d) => delete d.tables['t:10']);
    markStale();
    expect(store.getState()).toMatchObject({ stale: true, version: 1 });
    store.getState().load({ model: fixtureModel, casts, fingerprint: 'f2' });
    expect(store.getState()).toMatchObject({
      stale: false,
      version: 0,
      loadedFingerprint: 'f2',
    });
    expect(store.getState().desired.tables['t:10']).toBeDefined();
  });

  test('an edit changes a copy: the old desired and the baseline are untouched, and the version counts it', () => {
    const store = createSchemaStore();
    store.getState().load({ model: fixtureModel, casts, fingerprint: 'f1' });
    const before = store.getState().desired;
    store.getState().edit((d) => (d.tables['t:10']!.name = 'people'));
    const s = store.getState();
    expect(s.desired).not.toBe(before);
    expect(s.desired.tables['t:10']!.name).toBe('people');
    expect(before.tables['t:10']!.name).toBe('users');
    expect(s.baseline.tables['t:10']!.name).toBe('users');
    expect(s.version).toBe(1);
    s.edit(() => undefined);
    expect(store.getState().version).toBe(2);
  });

  test('markStale only sets the flag', () => {
    const store = createSchemaStore();
    store.getState().load({ model: fixtureModel, casts, fingerprint: 'f1' });
    store.getState().markStale();
    expect(store.getState()).toMatchObject({ stale: true, version: 0 });
  });
});
