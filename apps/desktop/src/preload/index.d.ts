import type { PgsketchApi } from '../shared/ipc-contract';

declare global {
  interface Window {
    api: PgsketchApi;
  }
}
