import type { AnyFieldApi } from '@tanstack/react-form';
import type { ComponentProps } from 'react';
import { PasswordInput } from '@/components/PasswordInput';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type InputProps = Omit<
  ComponentProps<'input'>,
  'id' | 'name' | 'value' | 'onChange' | 'onBlur'
>;

interface FormTextFieldProps extends InputProps {
  field: AnyFieldApi;
  label: string;
}

/**
 * A labelled text input for a form field: it shows the schema's message once the field has been
 * touched (a submit touches every field) and is invalid, and says so to assistive technology. A
 * password field gets a button to show and hide what is typed.
 */
export function FormTextField({
  field,
  label,
  type,
  ...input
}: FormTextFieldProps) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const props = {
    id: field.name,
    name: field.name,
    value: field.state.value,
    onBlur: field.handleBlur,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      field.handleChange(e.target.value),
    'aria-invalid': invalid,
    'aria-describedby': invalid ? `${field.name}-error` : undefined,
    ...input,
  };
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {type === 'password' ? (
        <PasswordInput {...props} />
      ) : (
        <Input type={type} {...props} />
      )}
      {invalid && (
        <FieldError
          id={`${field.name}-error`}
          errors={field.state.meta.errors}
        />
      )}
    </Field>
  );
}
