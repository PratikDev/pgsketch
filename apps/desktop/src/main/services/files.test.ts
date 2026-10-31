import { describe, expect, test, vi } from 'vitest';
import { openAppDb } from '../store/db';
import { createSettingsRepo } from '../store/settings';
import { createFiles, type SaveDialogResult } from './files';

function setup(answers: SaveDialogResult[]) {
  const asked: string[] = [];
  const written: { path: string; text: string }[] = [];
  const answer = [...answers];
  const files = createFiles({
    settings: createSettingsRepo(openAppDb(':memory:')),
    defaultFolder: () => '/home/me/Documents',
    showSaveDialog: async ({ defaultPath }) => {
      asked.push(defaultPath);
      return answer.shift() ?? { canceled: true, filePath: '' };
    },
    write: async (path, text) => void written.push({ path, text }),
  });
  return { files, asked, written };
}

describe('saving a migration', () => {
  test('writes the text where the dialog says, and the second save opens in that folder', async () => {
    const { files, asked, written } = setup([
      { canceled: false, filePath: '/work/migrations/first.sql' },
      { canceled: false, filePath: '/work/migrations/second.sql' },
    ]);
    expect(
      await files.save('SELECT 1;', '20260101_000000_pgsketch.sql'),
    ).toEqual({ status: 'saved', path: '/work/migrations/first.sql' });
    await files.save('SELECT 2;', '20260101_000100_pgsketch.sql');
    expect(asked).toEqual([
      '/home/me/Documents/20260101_000000_pgsketch.sql',
      '/work/migrations/20260101_000100_pgsketch.sql',
    ]);
    expect(written).toEqual([
      { path: '/work/migrations/first.sql', text: 'SELECT 1;' },
      { path: '/work/migrations/second.sql', text: 'SELECT 2;' },
    ]);
  });

  test('a cancelled dialog writes nothing and keeps the last folder', async () => {
    const { files, asked, written } = setup([
      { canceled: false, filePath: '/work/a.sql' },
      { canceled: true, filePath: '' },
    ]);
    await files.save('a', 'a.sql');
    expect(await files.save('b', 'b.sql')).toEqual({ status: 'cancelled' });
    await files.save('c', 'c.sql');
    expect(written).toHaveLength(1);
    expect(asked[2]).toBe('/work/c.sql');
  });

  test('a suggested name can not pick a folder', async () => {
    const { files, asked } = setup([]);
    await files.save('x', '../../etc/passwd');
    expect(asked).toEqual(['/home/me/Documents/passwd']);
  });

  test("a file that can't be written is an error, and the folder is not remembered", async () => {
    const files = createFiles({
      settings: createSettingsRepo(openAppDb(':memory:')),
      defaultFolder: () => '/d',
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: '/nope/a.sql',
      })),
      write: async () => {
        throw new Error('EACCES');
      },
    });
    await expect(files.save('x', 'a.sql')).rejects.toThrow('EACCES');
    await expect(files.save('x', 'a.sql')).rejects.toThrow('EACCES');
  });
});
