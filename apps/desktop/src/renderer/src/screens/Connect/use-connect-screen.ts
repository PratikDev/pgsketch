import { useEffect, useState } from 'react';
import { api } from '@/api';
import type {
  ConnectionDefaults,
  OpenResult,
  SavedConnection,
  SessionInfo,
} from '../../../../shared/ipc-contract';
import {
  initialState,
  validate,
  withMode,
  withUrl,
  type FieldErrors,
  type FormState,
  type Mode,
} from './connect-form';

/** Used until the main process answers, and if it never does. */
const FALLBACK_DEFAULTS: ConnectionDefaults = {
  osUser: '',
  socketPath: '/var/run/postgresql',
};

/** The Connect screen's state: the form, the recent connections, and opening one. */
export function useConnectScreen(onOpened: (session: SessionInfo) => void) {
  const [state, setState] = useState<FormState>(initialState);
  const [defaults, setDefaults] = useState(FALLBACK_DEFAULTS);
  const [recent, setRecent] = useState<SavedConnection[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void api.connection.defaults().then(
      (d) => current && setDefaults(d),
      () => undefined,
    );
    void api.connection.recent().then(
      (r) => current && setRecent(r),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  /** Runs an open call; on success the screen is left, otherwise the reason is shown. */
  async function run(open: () => Promise<OpenResult>): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await open();
      if (result.status === 'opened') return onOpened(result.session);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  }

  return {
    state,
    errors,
    message,
    busy,
    recent,
    change: (change: Partial<FormState>) => {
      setState((s) => ({ ...s, ...change }));
      setErrors({});
    },
    changeUrl: (url: string) => {
      setState((s) => withUrl(s, url));
      setErrors({});
    },
    changeMode: (mode: Mode) => {
      setState((s) => withMode(s, mode, defaults));
      setErrors({});
    },
    submit: () => {
      const result = validate(state);
      if ('errors' in result) return setErrors(result.errors);
      void run(() => api.connection.open(result.params, state.remember));
    },
    openRecent: (connectionId: string) =>
      void run(() => api.connection.openSaved(connectionId)),
  };
}
