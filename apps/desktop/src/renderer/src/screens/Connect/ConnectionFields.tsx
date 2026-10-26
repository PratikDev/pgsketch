import { FormTextField } from '@/components/FormTextField';
import { FieldGroup } from '@/components/ui/field';
import { useSelector } from '@tanstack/react-form';
import { takeSslMode } from './connect-schema';
import type { ConnectForm } from './use-connect-screen';

/** The fields for how to reach the server, which depend on the mode. */
export function ConnectionFields({ form }: { form: ConnectForm }) {
  const mode = useSelector(form.store, (s) => s.values.mode);

  if (mode === 'url') {
    return (
      <form.Field
        name="url"
        listeners={{
          // a pasted string's sslmode moves to the selector, and is taken out of the text
          onChange: ({ value, fieldApi }) => {
            const taken = takeSslMode(value);
            if (!taken) return;
            fieldApi.form.setFieldValue('url', taken.text);
            if (taken.sslMode)
              fieldApi.form.setFieldValue('sslMode', taken.sslMode);
          },
        }}
      >
        {(field) => (
          <FormTextField
            field={field}
            label="Connection string"
            placeholder="postgresql://user:password@host:5432/database"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </form.Field>
    );
  }

  const socket = mode === 'socket';
  return (
    <FieldGroup>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <form.Field name="host">
          {(field) => (
            <FormTextField
              field={field}
              label={socket ? 'Socket directory' : 'Host'}
              spellCheck={false}
            />
          )}
        </form.Field>
        <form.Field name="port">
          {(field) => (
            <FormTextField field={field} label="Port" inputMode="numeric" />
          )}
        </form.Field>
      </div>
      <form.Field name="user">
        {(field) => (
          <FormTextField
            field={field}
            label="User"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </form.Field>
      {!socket && (
        <form.Field name="password">
          {(field) => (
            <FormTextField
              field={field}
              label="Password"
              type="password"
              autoComplete="off"
            />
          )}
        </form.Field>
      )}
      <form.Field name="database">
        {(field) => (
          <FormTextField
            field={field}
            label="Database"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </form.Field>
    </FieldGroup>
  );
}
