import { api } from '@/api';
import { useForm, useSelector } from '@tanstack/react-form';
import { useEffect, useState } from 'react';
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

/**
 * The message a failed connection left on the form, if there is one. The form's own errors are the
 * schema's, which are objects keyed by field; a message set by hand is a string.
 */
const serverMessage = (errors: readonly unknown[]): string | null =>
  errors.find((error): error is string => typeof error === 'string') ?? null;

/** The Connect screen: its form, the recent connections, and opening one. */
export function useConnectScreen(onOpened: (session: SessionInfo) => void) {
  const [defaults, setDefaults] = useState(FALLBACK_DEFAULTS);
  const [recent, setRecent] = useState<SavedConnection[]>([]);
  const [openingRecent, setOpeningRecent] = useState(false);

  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: connectSchema },
    onSubmit: async ({ value, formApi }) => {
      // the form hands over what was typed; the schema turns it into the connection parameters
      const { params, remember } = connectSchema.parse(value);
      const result = await api.connection.open(params, remember);
      showResult(result, formApi.setErrorMap);
    },
  });

  /** Leaves the screen when the database opened, otherwise puts the reason on the form. */
  function showResult(
    result: OpenResult,
    setErrorMap: typeof form.setErrorMap,
  ): void {
    if (result.status === 'opened') return onOpened(result.session);
    setErrorMap({ onSubmit: { form: result.message, fields: {} } });
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
  const message = useSelector(form.store, (s) => serverMessage(s.errors));

  return {
    form,
    defaults,
    recent,
    message,
    busy: submitting || openingRecent,
    openRecent: async (connectionId: string): Promise<void> => {
      form.setErrorMap({ onSubmit: undefined });
      setOpeningRecent(true);
      try {
        showResult(
          await api.connection.openSaved(connectionId),
          form.setErrorMap,
        );
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : String(error),
            fields: {},
          },
        });
      }
      setOpeningRecent(false);
    },
  };
}

export type ConnectForm = ReturnType<typeof useConnectScreen>['form'];
