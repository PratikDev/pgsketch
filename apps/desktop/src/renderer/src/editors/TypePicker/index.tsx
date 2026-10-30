import type { PgType } from '@pgsketch/core';
import { uiStore, useUiStore } from '@/stores/ui';
import { typeLabel } from '@/canvas/model-view';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { showRefusal } from '@/lib/refusal';
import { cn } from '@/lib/utils';
import { TypeParams } from './TypeParams';
import { BUILTIN_TYPES, builtinOf } from './types';
import { useEnumTypes } from './use-enum-types';

const sameType = (a: PgType, b: PgType) =>
  a.name === b.name && a.schema === b.schema;

/**
 * A column's type, which opens a searchable list of the built-in types and the database's enums.
 * A type with parameters (`varchar`, `numeric`…) keeps the popover open for them; every change goes
 * straight to `onChange`, whose answer is why it was refused, if it was, and that is shown as a toast.
 */
export function TypePicker({
  id,
  value,
  disabled = false,
  onChange,
  className,
}: {
  /** The column, which names this editor in the UI store: only one is open at a time. */
  id: string;
  value: PgType;
  disabled?: boolean;
  onChange: (type: PgType) => string | null;
  className?: string;
}) {
  const key = `${id}:type`;
  // open in the UI store, so the canvas can close it with a click on the empty canvas
  const open = useUiStore((s) => s.editing === key);
  const enums = useEnumTypes();
  const builtin = builtinOf(value);

  if (disabled)
    return (
      <span className={cn('min-w-0 truncate', className)}>
        {typeLabel(value)}
      </span>
    );

  const apply = (type: PgType) => {
    const reason = onChange(type);
    showRefusal(reason);
    return reason === null;
  };
  const choose = (type: PgType) => {
    const applied = apply({ ...type, isArray: value.isArray });
    // a type with parameters stays open for them
    if (applied && (builtinOf(type)?.params.length ?? 0) === 0)
      uiStore.getState().stopEditing(key);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) uiStore.getState().startEditing(key);
        else uiStore.getState().stopEditing(key);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Column type"
          className={cn('nodrag min-w-0 truncate text-left', className)}
        >
          {typeLabel(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="nodrag nopan nowheel w-64 gap-2 p-1"
      >
        <Command>
          <CommandInput placeholder="Search types…" />
          <CommandList>
            <CommandEmpty>No type found.</CommandEmpty>
            <CommandGroup heading="Built-in types">
              {BUILTIN_TYPES.map((b) => (
                <CommandItem
                  key={b.name}
                  value={b.name}
                  data-checked={builtin === b}
                  onSelect={() => choose({ name: b.name, isArray: false })}
                >
                  {b.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {enums.length > 0 && (
              <CommandGroup heading="Enums">
                {enums.map((e) => (
                  <CommandItem
                    key={`${e.schema}.${e.name}`}
                    value={`${e.schema}.${e.name}`}
                    data-checked={sameType(value, e)}
                    onSelect={() => choose(e)}
                  >
                    {e.schema}.{e.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <div className="flex flex-col gap-2 px-2 pb-2">
          {builtin && builtin.params.length > 0 && (
            <TypeParams builtin={builtin} value={value} onChange={apply} />
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.isArray}
              onCheckedChange={(checked) =>
                apply({ ...value, isArray: checked === true })
              }
            />
            Array
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
