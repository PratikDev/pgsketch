import { contextBridge, ipcRenderer } from 'electron';
import { createApi } from './api';

// Context isolation is always on (see the security baseline in the build plan).
contextBridge.exposeInMainWorld('api', createApi(ipcRenderer));
