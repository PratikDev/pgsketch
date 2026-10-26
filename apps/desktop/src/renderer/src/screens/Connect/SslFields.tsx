import { TextField } from '@/components/TextField';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SSL_MODES, type SslMode } from '../../../../shared/ipc-contract';
import {
  effectiveSslMode,
  type FieldErrors,
  type FormState,
} from './connect-form';

/** What each mode means, shown under the selector. */
const NOTES: Record<SslMode, string> = {
  disable: 'No encryption.',
  prefer: 'Encrypted if the server offers it, otherwise not.',
  require: 'Encrypted, but the server is not verified.',
  'verify-full': 'Encrypted, and the certificate and host name are checked.',
};

interface Props {
  state: FormState;
  errors: FieldErrors;
  onChange: (change: Partial<FormState>) => void;
}

export function SslFields({ state, errors, onChange }: Props) {
  const mode = effectiveSslMode(state);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ssl-mode">SSL mode</Label>
        <Select
          value={mode}
          onValueChange={(value) => {
            const picked = SSL_MODES.find((m) => m === value);
            if (picked) onChange({ sslMode: picked });
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
        <p className="text-sm text-muted-foreground">{NOTES[mode]}</p>
      </div>
      {mode === 'verify-full' && (
        <TextField
          id="ssl-ca"
          label="CA certificate file"
          placeholder="/path/to/ca.pem"
          spellCheck={false}
          value={state.sslCaPath}
          error={errors.sslCaPath}
          onChange={(e) => onChange({ sslCaPath: e.target.value })}
        />
      )}
    </div>
  );
}
