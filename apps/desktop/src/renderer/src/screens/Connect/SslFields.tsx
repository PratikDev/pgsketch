import { FormTextField } from '@/components/FormTextField';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSelector } from '@tanstack/react-form';
import { SSL_MODES, type SslMode } from '../../../../shared/ipc-contract';
import { effectiveSslMode } from './connect-schema';
import type { ConnectForm } from './use-connect-screen';

/** What each mode means, shown under the selector. */
const NOTES: Record<SslMode, string> = {
  disable: 'No encryption.',
  prefer: 'Encrypted if the server offers it, otherwise not.',
  require: 'Encrypted, but the server is not verified.',
  'verify-full': 'Encrypted, and the certificate and host name are checked.',
};

export function SslFields({ form }: { form: ConnectForm }) {
  // until one is picked the form holds null, and what is shown follows the host
  const mode = useSelector(form.store, (s) => effectiveSslMode(s.values));
  return (
    <FieldGroup>
      <form.Field name="sslMode">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="ssl-mode">SSL mode</FieldLabel>
            <Select
              value={mode}
              onValueChange={(value) => {
                const picked = SSL_MODES.find((m) => m === value);
                if (picked) field.handleChange(picked);
              }}
            >
              <SelectTrigger id="ssl-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SSL_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{NOTES[mode]}</FieldDescription>
          </Field>
        )}
      </form.Field>
      {mode === 'verify-full' && (
        <form.Field name="sslCaPath">
          {(field) => (
            <FormTextField
              field={field}
              label="CA certificate file"
              placeholder="/path/to/ca.pem"
              spellCheck={false}
            />
          )}
        </form.Field>
      )}
    </FieldGroup>
  );
}
