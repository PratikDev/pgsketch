import { Hint } from '@/components/Hint';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { schemaStore } from '@/stores/schema';
import type { ColumnView } from './model-view';

function Toggle({
  label,
  on,
  disabled,
  title,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  title: string;
  onToggle: () => void;
}) {
  // the span takes the pointer for a disabled badge, which has none, so the reason still shows
  return (
    <Hint label={title}>
      <span className="inline-flex">
        <Badge
          asChild
          variant={on ? 'secondary' : 'outline'}
          className={cn(
            'px-1.5 disabled:pointer-events-none',
            !on && 'opacity-40',
          )}
        >
          <button
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={onToggle}
            className="nodrag"
          >
            {label}
          </button>
        </Badge>
      </span>
    </Hint>
  );
}

/**
 * PK, NN and UQ of a column: each is a switch, faded when off. NOT NULL can't be turned off while
 * the column is in the primary key or is an identity column.
 */
export function KeyBadges({
  column,
  editable,
}: {
  column: ColumnView;
  editable: boolean;
}) {
  const store = () => schemaStore.getState();
  const required = column.primaryKey
    ? 'NOT NULL: required by the primary key'
    : column.identity
      ? 'NOT NULL: required by the identity column'
      : null;
  return (
    <>
      <Toggle
        label="PK"
        on={column.primaryKey}
        disabled={!editable}
        title="Primary key"
        onToggle={() => store().setPrimaryKey(column.id, !column.primaryKey)}
      />
      <Toggle
        label="NN"
        on={column.notNull}
        disabled={!editable || required !== null}
        title={required ?? 'NOT NULL'}
        onToggle={() => store().setNotNull(column.id, !column.notNull)}
      />
      <Toggle
        label="UQ"
        on={column.unique}
        disabled={!editable}
        title="Unique"
        onToggle={() => store().setUnique(column.id, !column.unique)}
      />
    </>
  );
}
