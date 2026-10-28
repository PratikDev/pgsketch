import { useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { uiStore, useUiStore } from '@/stores/ui';

/**
 * A name that becomes an input when it is clicked. Enter, Tab or leaving the input commits it,
 * Esc cancels; an empty or unchanged text commits nothing. Only one is open at a time: the
 * `id` is the key the UI store knows the open one by.
 */
export function InlineText({
  id,
  label,
  value,
  disabled = false,
  onCommit,
  className,
}: {
  id: string;
  /** What is being named, for assistive technology: "column name". */
  label: string;
  value: string;
  disabled?: boolean;
  onCommit: (text: string) => void;
  className?: string;
}) {
  const editing = useUiStore((s) => s.editing === id);
  const [draft, setDraft] = useState(value);
  // Tab commits, and then the input loses focus: that must not commit a second time
  const finished = useRef(false);

  if (disabled)
    return <span className={cn('truncate', className)}>{value}</span>;

  if (!editing)
    return (
      <button
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
    uiStore.getState().stopEditing(id);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
    else if (event.key === 'Tab') finish(true);
  };
  return (
    <Input
      autoFocus
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      // the node must not drag, nor the canvas pan, while the text is selected with the mouse
      className={cn(
        'nodrag nopan h-6 min-w-0 px-1 text-sm md:text-sm',
        className,
      )}
    />
  );
}
