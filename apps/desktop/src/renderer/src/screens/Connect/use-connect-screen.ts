import { api } from '@/api';
import { useForm, useSelector } from '@tanstack/react-form';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type {
  ConnectionDefaults,
  OpenResult,
  SavedConnection,
  SessionInfo,
} from '../../../../shared/ipc-contract';
import { connectSchema, initialValues } from './connect-schema';

/** Used until the main process answers, and if it never does. */
const FALLBACK_DEFAULTS: ConnectionDefaults = {
  osUser: '',
  socketPath: '/var/run/postgresql',
};

/** The Connect screen: its form, the recent connections, and opening one. */
export function useConnectScreen(onOpened: (session: SessionInfo) => void) {
  const [defaults, setDefaults] = useState(FALLBACK_DEFAULTS);
  const [recent, setRecent] = useState<SavedConnection[]>([]);
  const [openingRecent, setOpeningRecent] = useState(false);

  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: connectSchema },
    onSubmit: async ({ value }) => {
      // the form hands over what was typed; the schema turns it into the connection parameters
      const { params, remember } = connectSchema.parse(value);
      const result = await api.connection.open(params, remember);
      showResult(result);
    },
  });

  /** Leaves the screen when the database opened, otherwise says why not. */
  function showResult(result: OpenResult): void {
    if (result.status === 'opened') return onOpened(result.session);
    toast.error(result.message);
  }

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

  const submitting = useSelector(form.store, (s) => s.isSubmitting);

  return {
    form,
    defaults,
    recent,
    busy: submitting || openingRecent,
    openRecent: async (connectionId: string): Promise<void> => {
      setOpeningRecent(true);
      try {
        showResult(await api.connection.openSaved(connectionId));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
      setOpeningRecent(false);
    },
  };
}

export type ConnectForm = ReturnType<typeof useConnectScreen>['form'];
