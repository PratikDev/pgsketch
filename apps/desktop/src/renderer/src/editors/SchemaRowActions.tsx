import type { Schema } from '@pgsketch/core';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { InlineText } from '@/editors/InlineText';
import { showRefusal } from '@/lib/refusal';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';

/** Whether a schema can be renamed or deleted: only one the migration creates. */
export const usePendingSchema = (schemaId: string): boolean =>
  useSchemaStore((s) => !s.baseline.schemas[schemaId]);

/**
 * For the items of a menu while a name is typed in it. A menu focuses the item under the pointer,
 * and itself when the pointer leaves one, which would take the focus from the input; a handler
 * that prevents the default keeps the menu from doing it.
 */
export const whileRenaming = {
  onPointerMove: (e: SyntheticEvent) => e.preventDefault(),
  onPointerLeave: (e: SyntheticEvent) => e.preventDefault(),
};

/** What a click on an icon does is the icon's alone: it must not also choose or tick the row. */
const own = (action: () => void) => ({
  onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
  onPointerUp: (e: SyntheticEvent) => e.stopPropagation(),
  onClick: (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    action();
  },
});

/** A pen and a trash can at the end of the row of a schema the migration creates; nothing for one in the database. */
export function SchemaRowActions({ schema }: { schema: Schema }) {
  if (!usePendingSchema(schema.id)) return null;
  return (
    <span className="ml-auto flex shrink-0 gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Rename schema ${schema.name}`}
        {...own(() => uiStore.getState().startEditing(`${schema.id}:name`))}
      >
        <PencilIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete schema ${schema.name}`}
        {...own(() =>
          showRefusal(schemaStore.getState().removeSchema(schema.id)),
        )}
      >
        <Trash2Icon />
      </Button>
    </span>
  );
}

/**
 * The name of a schema as an input, in place of its row. It is not a menu item, because a menu
 * takes the focus and the keys of its items; the keys typed here stay here.
 */
export function SchemaRenameInput({ schema }: { schema: Schema }) {
  return (
    <div
      role="presentation"
      className="px-1.5 py-1"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <InlineText
        id={`${schema.id}:name`}
        label="Schema name"
        value={schema.name}
        onCommit={(name) =>
          showRefusal(schemaStore.getState().renameSchema(schema.id, name))
        }
        className="w-full"
      />
    </div>
  );
}
