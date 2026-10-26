import { TextField } from '@/components/TextField';
import type { FieldErrors, FormState } from './connect-form';

interface Props {
  state: FormState;
  errors: FieldErrors;
  onChange: (change: Partial<FormState>) => void;
  onUrlChange: (url: string) => void;
}

/** The fields for how to reach the server, which depend on the mode. */
export function ConnectionFields({
  state,
  errors,
  onChange,
  onUrlChange,
}: Props) {
  if (state.mode === 'url') {
    return (
      <TextField
        id="connection-string"
        label="Connection string"
        placeholder="postgresql://user:password@host:5432/database"
        autoComplete="off"
        spellCheck={false}
        value={state.url}
        error={errors.url}
        onChange={(e) => onUrlChange(e.target.value)}
      />
    );
  }
  const socket = state.mode === 'socket';
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <TextField
          id="host"
          label={socket ? 'Socket directory' : 'Host'}
          spellCheck={false}
          value={state.host}
          error={errors.host}
          onChange={(e) => onChange({ host: e.target.value })}
        />
        <TextField
          id="port"
          label="Port"
          inputMode="numeric"
          value={state.port}
          error={errors.port}
          onChange={(e) => onChange({ port: e.target.value })}
        />
      </div>
      <TextField
        id="user"
        label="User"
        autoComplete="off"
        spellCheck={false}
        value={state.user}
        error={errors.user}
        onChange={(e) => onChange({ user: e.target.value })}
      />
      {!socket && (
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="off"
          value={state.password}
          onChange={(e) => onChange({ password: e.target.value })}
        />
      )}
      <TextField
        id="database"
        label="Database"
        autoComplete="off"
        spellCheck={false}
        value={state.database}
        error={errors.database}
        onChange={(e) => onChange({ database: e.target.value })}
      />
    </div>
  );
}
