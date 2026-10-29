import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { uiStore, useUiStore } from '@/stores/ui';

/**
 * A name that becomes an input when it is clicked. Enter, Tab or leaving the input commits it,
 * Esc cancels; an empty or unchanged text commits nothing. Only one is open at a time: the
 * `id` is the key the UI store knows the open one by.
 *
 * Enter and Esc give focus back to the name, and `onSubmit` runs after Enter (a table uses it to
 * go on to a new row). Tab leaves the input for the next thing on the page, as it does anywhere.
 */
export function InlineText({
  id,
  label,
  value,
  disabled = false,
  onCommit,
  onSubmit,
  onCancel,
  className,
}: {
  id: string;
  /** What is being named, for assistive technology: "column name". */
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (text: string) => void;
  /** After Enter, once the text is committed. */
  onSubmit?: () => void;
  /** After Esc, before the edit is over. */
  onCancel?: () => void;
  className?: string;
}) {
  const editing = useUiStore((s) => s.editing === id);
  const [draft, setDraft] = useState(value);
  // Tab commits, and then the input loses focus: that must not commit a second time
  const finished = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);

  // After Enter or Esc, focus is back on the name, unless another input has taken it. A moment
  // later, not at once: Enter's own key press would otherwise land on the button and open it again.
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    const timer = setTimeout(() => {
      if (uiStore.getState().editing === null) button.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [editing]);

  // The input takes focus once it is on the page. React Flow keeps a table hidden for a moment
  // after its content changes (a new row), and a hidden input can't be focused, so it tries again
  // on the next frames until it is.
  useEffect(() => {
    if (!editing) return;
    let frame = 0;
    let tries = 0;
    const focus = () => {
      input.current?.focus();
      if (document.activeElement !== input.current && tries++ < 20)
        frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  if (disabled)
    return <span className={cn('truncate', className)}>{value}</span>;

  if (!editing)
    return (
      <button
        ref={button}
        type="button"
        className={cn('nodrag truncate text-left', className)}
        onClick={() => {
          finished.current = false;
          setDraft(value);
          uiStore.getState().startEditing(id);
        }}
      >
        {value}
      </button>
    );

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const text = draft.trim();
    if (commit && text !== '' && text !== value) onCommit(text);
  };
  const stop = () => uiStore.getState().stopEditing(id);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      finish(true);
      refocus.current = true;
      stop();
      onSubmit?.();
    } else if (event.key === 'Escape') {
      finished.current = true;
      onCancel?.();
      refocus.current = true;
      stop();
    } else if (event.key === 'Tab') {
      // the input stays until the focus has left it, so the Tab goes where it would have gone
      finish(true);
    }
  };
  return (
    <Input
      ref={input}
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={onKeyDown}
      onBlur={() => {
        finish(true);
        stop();
      }}
      // the node must not drag, nor the canvas pan, while the text is selected with the mouse
      className={cn(
        'nodrag nopan h-6 min-w-0 px-1 text-sm md:text-sm',
        className,
      )}
    />
  );
}
