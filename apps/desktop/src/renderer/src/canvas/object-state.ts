import type { Id, ReadOnlyReason, ValidationError } from '@pgsketch/core';
import { cn } from '@/lib/utils';
import type { ObjectStatus, OldValues, StatusMap } from './status';

/** Everything that decides how a table or a column is drawn, other than what it is. */
export interface ObjectState {
  status: ObjectStatus | null;
  /** The first validation error on it. */
  error: string | null;
  readOnly: ReadOnlyReason | null;
}

/** What the diff and the validation say about the derived models, which is all the views need. */
export interface StateSources {
  statuses: StatusMap;
  errors: ValidationError[];
}

export function stateOf(
  id: Id,
  readOnly: ReadOnlyReason | undefined,
  sources?: StateSources,
): ObjectState {
  return {
    status: sources?.statuses[id] ?? null,
    error: sources?.errors.find((e) => e.objectId === id)?.message ?? null,
    readOnly: readOnly ?? null,
  };
}

export const READ_ONLY_LABELS: Record<ReadOnlyReason, string> = {
  'partitioned-table': 'partitioned table',
  partition: 'partition',
  'generated-column': 'generated column',
  'nextval-default': 'default from a sequence',
  'unsupported-type': 'type pgsketch can’t edit',
  'not-null-not-valid': 'NOT NULL that is not validated',
  'not-null-no-inherit': 'NOT NULL that is not inherited',
  deferrable: 'deferrable constraint',
  'not-valid': 'constraint that is not validated',
  'no-inherit': 'constraint that is not inherited',
  'match-full': 'MATCH FULL foreign key',
  'fk-set-columns': 'foreign key that sets only some columns',
  exclusion: 'exclusion constraint',
  'partial-index': 'partial index',
  'expression-index': 'expression index',
  'non-btree-index': 'index that isn’t a b-tree',
  'desc-index': 'index with descending columns',
  'include-index': 'index with included columns',
  'opclass-index': 'index with an operator class',
  'storage-options-index': 'index with storage options',
  'nulls-not-distinct-index': 'index with NULLS NOT DISTINCT',
};

/** Whether the user can edit it: not a read-only object, and not one that is being removed. */
export const isEditable = ({ status, readOnly }: ObjectState): boolean =>
  !readOnly && status?.status !== 'removed';

/** How the diff highlighting looks: a coloured left edge and tint for a status, an outline for an error, grey for read-only. */
export function stateClasses({ status, error, readOnly }: ObjectState): string {
  return cn(
    readOnly && 'bg-muted text-muted-foreground',
    status?.status === 'added' && 'border-l-2 border-l-added bg-added-tint',
    status?.status === 'modified' &&
      'border-l-2 border-l-modified bg-modified-tint',
    status?.status === 'removed' &&
      'border-l-2 border-l-destructive bg-removed-tint line-through opacity-60',
    error && 'outline-2 -outline-offset-2 outline-destructive',
  );
}

const oldText = (old: OldValues): string =>
  [
    old.name !== undefined && `name ${old.name}`,
    old.type !== undefined && `type ${old.type}`,
    old.notNull !== undefined && (old.notNull ? 'NOT NULL' : 'nullable'),
    old.default !== undefined && `default ${old.default ?? 'none'}`,
    old.comment !== undefined && 'comment',
    old.primaryKey !== undefined &&
      (old.primaryKey ? 'in the primary key' : 'not in the primary key'),
    old.unique !== undefined && (old.unique ? 'unique' : 'not unique'),
  ]
    .filter(Boolean)
    .join(', ');

/** The hover text: the error, why it is read-only, and what a modified object was. */
export function stateTitle({
  status,
  error,
  readOnly,
}: ObjectState): string | undefined {
  const lines = [
    error,
    readOnly && `Read-only: ${READ_ONLY_LABELS[readOnly]}`,
    status?.status === 'modified' && `Was: ${oldText(status.old)}`,
    status?.status === 'removed' && 'Removed; the change drops it',
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : undefined;
}
