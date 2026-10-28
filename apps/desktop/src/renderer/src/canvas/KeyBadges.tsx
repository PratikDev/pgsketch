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
  return (
    <Badge
      asChild
      variant={on ? 'secondary' : 'outline'}
      className={cn('px-1.5', !on && 'opacity-40')}
    >
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        title={title}
        onClick={onToggle}
        className="nodrag"
      >
        {label}
      </button>
    </Badge>
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
