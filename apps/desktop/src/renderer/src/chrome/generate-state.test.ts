import { describe, expect, test } from 'vitest';
import { generateBlocker } from './generate-state';

const ok = { changes: 3, errors: [], stale: false, lost: null };
const error = {
  code: 'name-empty' as const,
  objectId: 't',
  message: 'Table name is empty',
};

describe('generateBlocker', () => {
  test('is nothing when there are changes and nothing is wrong', () => {
    expect(generateBlocker(ok)).toBeNull();
  });

  test('says there is nothing to generate when there are no changes', () => {
    expect(generateBlocker({ ...ok, changes: 0 })).toMatch(/no changes/);
  });

  test('names the first validation error', () => {
    expect(
      generateBlocker({
        ...ok,
        errors: [error, { ...error, message: 'other' }],
      }),
    ).toBe('Fix this first: Table name is empty');
  });

  test('a stale schema, or a lost connection, comes before everything else', () => {
    expect(generateBlocker({ ...ok, stale: true, errors: [error] })).toMatch(
      /changed outside pgsketch/,
    );
    expect(generateBlocker({ ...ok, stale: true, lost: 'gone' })).toMatch(
      /connection .* lost/,
    );
    expect(generateBlocker({ ...ok, changes: 0, lost: 'gone' })).toMatch(
      /connection .* lost/,
    );
  });
});
