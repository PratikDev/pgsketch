import { writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import type { SaveResult } from '../../shared/ipc-contract';
import type { SettingsRepo } from '../store/settings';

const LAST_FOLDER = 'lastSaveFolder';

/** What the native save dialog answers, as far as the service looks at it. */
export interface SaveDialogResult {
  canceled: boolean;
  filePath: string;
}

export interface FilesDeps {
  settings: SettingsRepo;
  /** Where the dialog opens when nothing was saved yet. */
  defaultFolder: () => string;
  /** The native dialog; it gets the folder and name to start with. */
  showSaveDialog: (options: {
    defaultPath: string;
  }) => Promise<SaveDialogResult>;
  write?: (path: string, text: string) => Promise<void>;
}

/** Saves `.sql` files through the native dialog, which opens in the folder of the last save. */
export function createFiles({
  settings,
  defaultFolder,
  showSaveDialog,
  write = (path, text) => writeFile(path, text, 'utf8'),
}: FilesDeps) {
  return {
    async save(text: string, suggestedName: string): Promise<SaveResult> {
      const folder = settings.get(LAST_FOLDER, z.string()) ?? defaultFolder();
      // the name comes from the renderer: only its last part is used, so it can't pick a folder
      const { canceled, filePath } = await showSaveDialog({
        defaultPath: join(folder, basename(suggestedName)),
      });
      if (canceled || filePath === '') return { status: 'cancelled' };
      await write(filePath, text);
      settings.set(LAST_FOLDER, dirname(filePath));
      return { status: 'saved', path: filePath };
    },
  };
}

export type Files = ReturnType<typeof createFiles>;
