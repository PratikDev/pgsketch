import { MessageSquareIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { uiStore, useUiStore } from '@/stores/ui';

/** The key the comment of an object is edited under in the UI store. */
export const commentKey = (id: string): string => `${id}:comment`;

/** A small mark that an object has a comment, which shows it on hover and opens it on a click. */
export function CommentMark({ id, comment }: { id: string; comment: string }) {
  return (
    <button
      type="button"
      aria-label="Comment"
      title={comment}
      className="nodrag text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        uiStore.getState().startEditing(commentKey(id));
      }}
    >
      <MessageSquareIcon className="size-3.5" />
    </button>
  );
}

/**
 * The comment of a table or a column, in a popover that opens over the element it is put in (which
 * must be positioned) while the UI store is editing `<id>:comment`. Saving nothing removes it.
 */
export function CommentPopover({
  id,
  label,
  comment,
  onSave,
}: {
  id: string;
  /** What the comment is on, for the title: `billing.invoices` or `total`. */
  label: string;
  comment: string | null;
  onSave: (comment: string | null) => void;
}) {
  const key = commentKey(id);
  const open = useUiStore((s) => s.editing === key);
  const [text, setText] = useState(comment ?? '');
  if (!open) return null;
  const close = () => uiStore.getState().stopEditing(key);
  return (
    <Popover open onOpenChange={(next) => !next && close()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        />
      </PopoverAnchor>
      <PopoverContent align="start" className="nodrag nopan nowheel w-72 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Comment on {label}
          <Textarea
            aria-label="Comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-normal"
          />
        </label>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              onSave(text.trim() === '' ? null : text);
              close();
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
