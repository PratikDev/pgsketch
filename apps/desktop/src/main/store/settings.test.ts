import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { openAppDb } from './db';
import { createSettingsRepo } from './settings';

describe('the settings', () => {
  test('a value comes back as saved, and saving again replaces it', () => {
    const settings = createSettingsRepo(openAppDb(':memory:'));
    expect(settings.get('folder', z.string())).toBeUndefined();
    settings.set('folder', '/a');
    settings.set('folder', '/b');
    expect(settings.get('folder', z.string())).toBe('/b');
  });

  test('a value that is not what the schema accepts is as good as none', () => {
    const db = openAppDb(':memory:');
    const settings = createSettingsRepo(db);
    settings.set('folder', 5);
    expect(settings.get('folder', z.string())).toBeUndefined();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'broken',
      '{not json',
    );
    expect(settings.get('broken', z.string())).toBeUndefined();
  });
});
