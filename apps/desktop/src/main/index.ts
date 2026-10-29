import { mkdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import type { EmitEvent } from './ipc/deps';
import { registerAllIpc } from './ipc';
import { createLogger, fileSink } from './log';
import { resolveAppPaths } from './paths';
import { createSession } from './session';
import { openConnection } from './services/connection';
import { openTaskConnection } from './services/task-connection';
import { createSecrets } from './services/secrets';
import { createConnectionsRepo } from './store/connections';
import { createLayoutsRepo } from './store/layouts';
import { openAppDb } from './store/db';

// Before anything else: where the app keeps its files, which is also Electron's user data folder,
// and the folder the single-instance lock belongs to.
const paths = resolveAppPaths();
mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
app.setPath('userData', paths.dataDir);

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const emit: EmitEvent = (event, ...payload) => {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send(event, ...payload);
};

// A second launch with the same data folder hands over to the first and exits, so two windows
// can't overwrite each other's drafts.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const session = createSession();

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(() => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron');

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    const log = createLogger({ write: fileSink(paths.logFile) });
    const db = openAppDb(paths.dbFile);
    registerAllIpc(ipcMain, {
      connections: createConnectionsRepo(db),
      layouts: createLayoutsRepo(db),
      secrets: createSecrets(safeStorage, () => app.isReady()),
      session,
      emit,
      open: openConnection,
      openTask: openTaskConnection,
      osUser: userInfo().username,
      socketPath: '/var/run/postgresql',
    });
    log.info('pgsketch started', { dataDir: paths.dataDir });

    createWindow();

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    void session.close();
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
