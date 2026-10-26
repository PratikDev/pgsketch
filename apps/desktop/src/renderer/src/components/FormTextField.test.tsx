import { useForm } from '@tanstack/react-form';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { FormTextField } from './FormTextField';

const schema = z.object({
  host: z.string().min(1, 'Enter a host'),
  secret: z.string(),
});

function Harness({ onSubmit }: { onSubmit: (host: string) => void }) {
  const form = useForm({
    defaultValues: { host: '', secret: 'pw' },
    validators: { onSubmit: schema },
    onSubmit: ({ value }) => onSubmit(value.host),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="host">
        {(field) => <FormTextField field={field} label="Host" />}
      </form.Field>
      <form.Field name="secret">
        {(field) => (
          <FormTextField field={field} label="Secret" type="password" />
        )}
      </form.Field>
      <button type="submit">Send</button>
    </form>
  );
}

describe('FormTextField', () => {
  test('shows no error until the form is submitted, then the schema message on the field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const host = screen.getByLabelText('Host');
    expect(host).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a host');
    expect(host).toHaveAttribute('aria-invalid', 'true');
    expect(host).toHaveAccessibleDescription('Enter a host');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('the error goes when the value is fixed, and the form then submits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('alert');
    await user.type(screen.getByLabelText('Host'), 'db');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith('db');
  });

  test('typing is kept in the form, and the label points at the input', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText('Host'), 'abc');
    expect(screen.getByLabelText('Host')).toHaveValue('abc');
  });

  test('a password field has the show and hide button, other fields do not', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /password/ })).toHaveLength(1);
    const secret = screen.getByLabelText('Secret');
    expect(secret).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(secret).toHaveAttribute('type', 'text');
  });

  test('the eye can be reached and used from the keyboard without submitting the form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.tab(); // host
    await user.tab(); // secret
    await user.tab(); // the eye
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'text');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
