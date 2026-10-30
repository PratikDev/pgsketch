import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { uiStore } from '@/stores/ui';
import { CommentMark, CommentPopover, commentKey } from './CommentPopover';

afterEach(() => act(() => uiStore.getState().cancelEditing()));

const setup = (comment: string | null = null) => {
  const onSave = vi.fn();
  render(
    <div style={{ position: 'relative' }}>
      <CommentPopover id="c1" label="total" comment={comment} onSave={onSave} />
    </div>,
  );
  act(() => uiStore.getState().startEditing(commentKey('c1')));
  return onSave;
};

describe('CommentPopover', () => {
  test('is nothing until its comment is being edited', () => {
    render(
      <CommentPopover id="c1" label="total" comment={null} onSave={vi.fn()} />,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('opens on the comment there is, and saves what is typed', async () => {
    const onSave = setup('Old note');
    const box = screen.getByRole('textbox', { name: 'Comment' });
    expect(box).toHaveValue('Old note');
    expect(screen.getByText('Comment on total')).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'Gross, in cents');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('Gross, in cents');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('saving nothing takes the comment away', async () => {
    const onSave = setup('Old note');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Comment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  test('Cancel saves nothing', async () => {
    const onSave = setup('Old note');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Comment' }),
      ' more',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(uiStore.getState().editing).toBeNull();
  });
});

describe('CommentMark', () => {
  test('shows the comment on hover, and opens it on a click', async () => {
    render(<CommentMark id="c1" comment="Gross, in cents" />);
    const mark = screen.getByRole('button', { name: 'Comment' });
    expect(mark).toHaveAttribute('title', 'Gross, in cents');
    await userEvent.click(mark);
    expect(uiStore.getState().editing).toBe('c1:comment');
  });
});
