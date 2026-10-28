import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { vi, afterEach, describe, expect, test } from 'vitest';
import { uiStore } from '@/stores/ui';
import { InlineText } from './InlineText';

afterEach(() => act(() => uiStore.setState({ editing: null })));

const setup = (props: Partial<Parameters<typeof InlineText>[0]> = {}) => {
  const onCommit = vi.fn();
  render(
    <InlineText
      id="a"
      label="Column name"
      value="email"
      onCommit={onCommit}
      {...props}
    />,
  );
  return onCommit;
};
const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'email' }));
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Column name' });
};

describe('InlineText', () => {
  test('shows the text, and an input with all of it selected once clicked', async () => {
    setup();
    const input = await open();
    expect(input).toHaveValue('email');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  test('Enter commits the trimmed text and shows it again', async () => {
    const onCommit = setup();
    await open();
    await userEvent.keyboard('_address  {Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('_address');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('Esc throws the typing away', async () => {
    const onCommit = setup();
    await open();
    await userEvent.keyboard('x{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'email' })).toBeInTheDocument();
  });

  test('Tab commits, once, although the input loses focus afterwards', async () => {
    const onCommit = setup();
    await open();
    await userEvent.keyboard('x{Tab}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('x');
  });

  test('leaving the input commits what was typed, so it is not lost', async () => {
    const onCommit = setup();
    await open();
    await userEvent.keyboard('x');
    await userEvent.click(document.body);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('x');
  });

  test('an empty or unchanged text commits nothing', async () => {
    const onCommit = setup();
    await open();
    await userEvent.keyboard('{Backspace}{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'email' }));
    await userEvent.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('the input cannot drag the node or pan the canvas', async () => {
    setup();
    expect(await open()).toHaveClass('nodrag', 'nopan');
  });

  test('only one is open: starting another commits the first', async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <InlineText id="a" label="First" value="one" onCommit={first} />
        <InlineText id="b" label="Second" value="two" onCommit={second} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'one' }));
    await userEvent.keyboard('1');
    await userEvent.click(screen.getByRole('button', { name: 'two' }));
    expect(first).toHaveBeenCalledExactlyOnceWith('1');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Second' })).toBeInTheDocument();
  });

  test('when disabled it is plain text that does not open', async () => {
    setup({ disabled: true });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('email'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
