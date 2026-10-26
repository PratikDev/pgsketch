import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TextFieldProps extends ComponentProps<typeof Input> {
  id: string;
  label: string;
  /** What is wrong with the value, shown under the field. */
  error?: string;
}

/** A labelled text input that shows its own error and says so to assistive technology. */
export function TextField({ id, label, error, ...input }: TextFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        {...input}
      />
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
