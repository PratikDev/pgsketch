import type { NormalizedExpression } from '@pgsketch/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { uiStore } from '@/stores/ui';
import { installFakeApi } from '@/test-utils';
import { ExpressionInput } from '.';
import { clearNormalizeCache } from './normalize-cache';

// toasts are drawn by the Toaster, which these tests don't mount: they check what was asked of `toast`
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

const columns = [
  { id: 'c1', name: 'status', type: { name: 'text', isArray: false } },
];
const target = { kind: 'default' as const, columnId: 'c1' };

/** The answers to ask for, by what was typed. */
function setup(
  answers: Record<string, NormalizedExpression> = {},
  onAnswer = vi.fn(),
) {
  const calls = installFakeApi({
    'expr.normalize': ({ expression }) =>
      answers[expression] ?? {
        status: 'normalized',
        expression: `${expression}::text`,
        columnIds: [],
      },
  });
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <ExpressionInput
        label="Expression"
        value={value}
        onChange={setValue}
        target={target}
        columns={columns}
        onAnswer={onAnswer}
      />
    );
  }
  render(<Harness />);
  const asked = () =>
    calls.filter((c) => c.channel === 'expr.normalize').map((c) => c.args[0]);
  return { asked, onAnswer, input: screen.getByLabelText('Expression') };
}
/** Types one key at a time, as a person does; user-event's own waits don't mix with fake timers. */
const type = (input: HTMLElement, text: string) => {
  for (const key of text)
    fireEvent.change(input, {
      target: { value: (input as HTMLInputElement).value + key },
    });
};
const clear = (input: HTMLElement) =>
  fireEvent.change(input, { target: { value: '' } });
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  clearNormalizeCache();
  vi.mocked(toast.warning).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  uiStore.setState({ normalizationFallback: false });
});

describe('ExpressionInput', () => {
  test('asks nothing until the typing has stopped for 400 ms, and then asks once', async () => {
    const { asked, input } = setup();
    type(input, 'abc');
    await wait(399);
    expect(asked()).toEqual([]);
    expect(input).toHaveAttribute('aria-busy', 'true');
    await wait(1);
    expect(asked()).toEqual([{ expression: 'abc', target, columns }]);
    expect(input).toHaveAttribute('aria-busy', 'false');
  });

  test('each key starts the 400 ms again', async () => {
    const { asked, input } = setup();
    type(input, 'a');
    await wait(300);
    type(input, 'b');
    await wait(300);
    expect(asked()).toEqual([]);
    await wait(100);
    expect(asked()).toHaveLength(1);
    expect(asked()[0]).toMatchObject({ expression: 'ab' });
  });

  test('shows what Postgres says is wrong, under the input, and the canonical text when it is not the typed one', async () => {
    const { input } = setup({
      'nonsense(': {
        status: 'invalid',
        message: 'syntax error at end of input',
      },
    });
    type(input, 'nonsense(');
    await wait(400);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'syntax error at end of input',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');

    clear(input);
    type(input, "'x'");
    await wait(400);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Stored as/)).toHaveTextContent("'x'::text");
  });

  test('hands each answer to onAnswer, the canonical text for a check with the columns it uses', async () => {
    const answer: NormalizedExpression = {
      status: 'normalized',
      expression: "(status <> ''::text)",
      columnIds: ['c1'],
    };
    const { onAnswer, input } = setup({ "status <> ''": answer });
    type(input, "status <> ''");
    await wait(400);
    expect(onAnswer).toHaveBeenCalledWith(answer);
  });

  test('takes the answer back at once when the text changes, so an old one is never used', async () => {
    const { onAnswer, input } = setup();
    type(input, 'a');
    await wait(400);
    expect(onAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'normalized' }),
    );
    type(input, 'b');
    expect(onAnswer).toHaveBeenLastCalledWith(null);
  });

  test('an answer that was got before is not asked for again, nor waited for', async () => {
    const { asked, onAnswer, input } = setup();
    type(input, 'abc');
    await wait(400);
    expect(asked()).toHaveLength(1);
    clear(input);
    type(input, 'abc');
    expect(asked()).toHaveLength(1);
    // from the cache at once, with no 400 ms
    expect(input).toHaveAttribute('aria-busy', 'false');
    // the answer is taken back while the text is different, and given again from the cache
    expect(onAnswer.mock.calls.filter(([a]) => a !== null)).toHaveLength(2);
    await wait(1000);
    expect(asked()).toHaveLength(1);
  });

  test('another table, or another column of it, is another request', async () => {
    const { asked, input } = setup();
    type(input, 'abc');
    await wait(400);
    expect(asked()).toHaveLength(1);
    clearNormalizeCache();
    clear(input);
    type(input, 'abc');
    await wait(400);
    expect(asked()).toHaveLength(2);
  });

  test('an empty input asks nothing, and shows nothing', async () => {
    const { asked, input } = setup();
    type(input, 'a');
    await wait(400);
    clear(input);
    await wait(1000);
    expect(asked()).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('says so when the request itself fails, and asks again for the same text on the next try', async () => {
    let fail = true;
    installFakeApi({
      'expr.normalize': ({ expression }) => {
        if (fail) throw new Error('No database is open');
        return { status: 'normalized', expression, columnIds: [] };
      },
    });
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <ExpressionInput
          label="Expression"
          value={value}
          onChange={setValue}
          target={target}
          columns={columns}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText('Expression');
    type(input, '1');
    await wait(400);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't check the expression: No database is open",
    );
    fail = false;
    type(input, '2');
    await wait(400);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('an answer that keeps the text as typed turns on the fallback, with one warning however often', async () => {
    const { input } = setup({
      a: { status: 'raw', expression: 'a' },
      b: { status: 'raw', expression: 'b' },
    });
    type(input, 'a');
    await wait(400);
    expect(uiStore.getState().normalizationFallback).toBe(true);
    clear(input);
    type(input, 'b');
    await wait(400);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});
