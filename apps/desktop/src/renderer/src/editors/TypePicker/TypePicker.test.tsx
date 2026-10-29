import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PgType } from '@pgsketch/core';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';
import { fixtureModel } from '@/test-model';
import { TypePicker } from '.';

const casts = { categories: {}, domains: {}, casts: {} };
afterEach(() => act(() => uiStore.getState().cancelEditing()));
beforeEach(() =>
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'f' }),
  ),
);

const text: PgType = { name: 'text', isArray: false };

/** A picker that keeps its own value, the way the store does for the column. */
function Harness({
  start = text,
  onChange = () => null,
}: {
  start?: PgType;
  onChange?: (t: PgType) => string | null;
}) {
  return <Stateful start={start} onChange={onChange} />;
}
import { useState } from 'react';
function Stateful({
  start,
  onChange,
}: {
  start: PgType;
  onChange: (t: PgType) => string | null;
}) {
  const [value, setValue] = useState(start);
  return (
    <TypePicker
      id="c"
      value={value}
      onChange={(t) => {
        const reason = onChange(t);
        if (reason === null) setValue(t);
        return reason;
      }}
    />
  );
}
const open = () =>
  userEvent.click(screen.getByRole('button', { name: 'Column type' }));

describe('TypePicker', () => {
  test('shows the type, and lists the built-in types and the existing enum when opened', async () => {
    render(<Harness />);
    expect(
      screen.getByRole('button', { name: 'Column type' }),
    ).toHaveTextContent('text');
    await open();
    for (const name of [
      'integer',
      'varchar',
      'numeric',
      'timestamptz',
      'jsonb',
    ])
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'public.user_status' }),
    ).toBeInTheDocument();
  });

  test('searching narrows the list', async () => {
    render(<Harness />);
    await open();
    await userEvent.type(screen.getByPlaceholderText('Search types…'), 'time');
    expect(
      screen.getByRole('option', { name: 'timestamptz' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'integer' }),
    ).not.toBeInTheDocument();
    await userEvent.clear(screen.getByPlaceholderText('Search types…'));
    await userEvent.type(screen.getByPlaceholderText('Search types…'), 'zzz');
    expect(screen.getByText('No type found.')).toBeInTheDocument();
  });

  test('choosing a type without parameters changes it and closes', async () => {
    const onChange = vi.fn(() => null);
    render(<Harness onChange={onChange} />);
    await open();
    await userEvent.click(screen.getByRole('option', { name: 'integer' }));
    expect(onChange).toHaveBeenCalledWith({ name: 'integer', isArray: false });
    expect(
      screen.queryByPlaceholderText('Search types…'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Column type' }),
    ).toHaveTextContent('integer');
  });

  test('choosing varchar shows a length input that sets the length', async () => {
    const onChange = vi.fn(() => null);
    render(<Harness onChange={onChange} />);
    await open();
    expect(screen.queryByLabelText('Length')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'varchar' }));
    const length = screen.getByLabelText('Length');
    expect(length).toBeInTheDocument();
    await userEvent.type(length, '80');
    expect(onChange).toHaveBeenLastCalledWith({
      name: 'varchar',
      params: [80],
      isArray: false,
    });
    expect(
      screen.getByRole('button', { name: 'Column type' }),
    ).toHaveTextContent('varchar(80)');
    await userEvent.clear(length);
    expect(onChange).toHaveBeenLastCalledWith({
      name: 'varchar',
      isArray: false,
    });
  });

  test('numeric has a precision and a scale, and a scale needs a precision', async () => {
    const onChange = vi.fn(() => null);
    render(
      <Harness
        start={{ name: 'numeric', isArray: false }}
        onChange={onChange}
      />,
    );
    await open();
    await userEvent.type(screen.getByLabelText('Scale'), '2');
    expect(onChange).toHaveBeenLastCalledWith({
      name: 'numeric',
      isArray: false,
    });
    await userEvent.type(screen.getByLabelText('Precision'), '10');
    await userEvent.type(screen.getByLabelText('Scale'), '2');
    expect(onChange).toHaveBeenLastCalledWith({
      name: 'numeric',
      params: [10, 2],
      isArray: false,
    });
  });

  test('an existing enum is chosen with its schema', async () => {
    const onChange = vi.fn(() => null);
    render(<Harness onChange={onChange} />);
    await open();
    await userEvent.click(
      screen.getByRole('option', { name: 'public.user_status' }),
    );
    expect(onChange).toHaveBeenCalledWith({
      name: 'user_status',
      schema: 'public',
      isArray: false,
    });
  });

  test('the array switch turns any type into an array and back', async () => {
    const onChange = vi.fn(() => null);
    render(<Harness onChange={onChange} />);
    await open();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Array' }));
    expect(onChange).toHaveBeenLastCalledWith({ name: 'text', isArray: true });
    expect(
      screen.getByRole('button', { name: 'Column type' }),
    ).toHaveTextContent('text[]');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Array' }));
    expect(onChange).toHaveBeenLastCalledWith({ name: 'text', isArray: false });
  });

  test('a type the store refuses stays unchanged, says why, and the picker stays open', async () => {
    render(<Harness onChange={() => 'it is an identity column'} />);
    await open();
    await userEvent.click(screen.getByRole('option', { name: 'varchar' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'it is an identity column',
    );
    expect(
      screen.getByRole('button', { name: 'Column type' }),
    ).toHaveTextContent('text');
  });

  test('when disabled it is plain text', () => {
    render(<TypePicker id="c" value={text} disabled onChange={() => null} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('text')).toBeInTheDocument();
  });
});
