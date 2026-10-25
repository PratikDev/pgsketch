import { registerIpc, type IpcRegistry } from './register';

export function registerApp(ipc: IpcRegistry): void {
  registerIpc(ipc, 'app.ping', ({ message }) => ({ message }));
}
