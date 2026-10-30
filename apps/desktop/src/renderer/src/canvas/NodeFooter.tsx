import { LockIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckEditor } from '@/editors/CheckEditor';
import { IndexEditor } from '@/editors/IndexEditor';
import { InlineText } from '@/editors/InlineText';
import { cn } from '@/lib/utils';
import { schemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';
import { FOOTER_HEIGHT } from '@/layout/autoLayout';
import {
  UNMODELED_LABELS,
  type ConstraintView,
  type IndexView,
  type UnmodeledView,
} from './footer-view';
import type { TableView } from './model-view';
import {
  isEditable,
  stateClasses,
  stateTitle,
  type ObjectState,
} from './object-state';

const plural = (n: number, [one, many]: [string, string]) =>
  `${n} ${n === 1 ? one : many}`;
const isLive = (o: { state: ObjectState }) =>
  o.state.status?.status !== 'removed';

/** "1 view · 2 triggers", and the names of them. */
function unmodeledSummary(objects: UnmodeledView[]) {
  const kinds = [...new Set(objects.map((o) => o.kind))];
  return {
    text: kinds
      .map((kind) =>
        plural(
          objects.filter((o) => o.kind === kind).length,
          UNMODELED_LABELS[kind],
        ),
      )
      .join(' · '),
    names: objects
      .map((o) => `${UNMODELED_LABELS[o.kind][0]} ${o.name}`)
      .join('\n'),
  };
}

/** One index or constraint in the list: its state shows as on a row, and it comes back by a click when it was removed. */
function Entry({
  state,
  title,
  onRestore,
  children,
}: {
  state: ObjectState;
  title?: string;
  onRestore: () => void;
  children: ReactNode;
}) {
  const removed = state.status?.status === 'removed';
  return (
    <li
      title={[stateTitle(state), title].filter(Boolean).join('\n') || undefined}
      data-status={state.status?.status}
      aria-invalid={state.error !== null || undefined}
      onClick={removed ? onRestore : undefined}
      className={cn(
        'flex h-7 items-center gap-2 px-3',
        removed && 'cursor-pointer',
        stateClasses(state),
      )}
    >
      {children}
      {state.readOnly && (
        <LockIcon
          aria-label="Read-only"
          className="ml-auto size-3.5 shrink-0"
        />
      )}
    </li>
  );
}

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      className="nodrag ml-auto"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Trash2Icon />
    </Button>
  );
}

function IndexEntry({ index }: { index: IndexView }) {
  const store = schemaStore.getState;
  const editable = isEditable(index.state);
  return (
    <Entry
      state={index.state}
      title={index.definition ?? undefined}
      onRestore={() => store().restoreIndex(index.id)}
    >
      <InlineText
        id={`${index.id}:name`}
        label="Index name"
        value={index.name}
        disabled={!editable}
        onCommit={(name) => store().renameIndex(index.id, name)}
        className="min-w-0 max-w-40"
      />
      <span className="truncate text-muted-foreground">
        ({index.columns.join(', ')})
      </span>
      {index.unique && <Badge variant="secondary">UQ</Badge>}
      {editable && (
        <Remove
          label={`Delete index ${index.name}`}
          onClick={() => store().removeIndex(index.id)}
        />
      )}
    </Entry>
  );
}

function ConstraintEntry({ constraint }: { constraint: ConstraintView }) {
  const store = schemaStore.getState;
  const editable = isEditable(constraint.state);
  return (
    <Entry
      state={constraint.state}
      title={constraint.definition ?? undefined}
      onRestore={() => store().restoreConstraint(constraint.id)}
    >
      <InlineText
        id={`${constraint.id}:name`}
        label="Constraint name"
        value={constraint.name}
        disabled={!editable}
        onCommit={(name) => store().renameConstraint(constraint.id, name)}
        className="min-w-0 max-w-40"
      />
      <span className="truncate font-mono text-muted-foreground">
        {constraint.expression ?? constraint.kind}
      </span>
      {editable && (
        <Remove
          label={`Delete constraint ${constraint.name}`}
          onClick={() => store().removeConstraint(constraint.id)}
        />
      )}
    </Entry>
  );
}

/**
 * The bar at the foot of a table: how many indexes and checks it has, and what pgsketch doesn't
 * edit that depends on it (views, triggers…). It opens into the lists, with a place to add an
 * index or a check; a read-only index or constraint is in them, with its lock and no way to change it.
 */
export function NodeFooter({ table }: { table: TableView }) {
  const { indexes, constraints, unmodeled } = table.footer;
  const editing = useUiStore((s) => s.editing);
  const [open, setOpen] = useState(false);
  const adding =
    editing === `${table.id}:index`
      ? 'index'
      : editing === `${table.id}:check`
        ? 'check'
        : null;
  // an index or check being added opens the lists, and they stay open to show it
  useEffect(() => {
    if (adding !== null) setOpen(true);
  }, [adding]);
  const expanded = open || adding !== null;
  const editable = isEditable(table.state);
  const checks = constraints.filter((c) => c.kind === 'check' && isLive(c));
  const extra = unmodeledSummary(unmodeled);
  const add = (what: 'index' | 'check') =>
    uiStore.getState().startEditing(`${table.id}:${what}`);

  return (
    <footer className="border-t border-border text-xs">
      <div
        style={{ height: FOOTER_HEIGHT }}
        className="flex items-center gap-2 px-3 text-muted-foreground"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label="Indexes and checks"
          className="nodrag truncate hover:text-foreground"
          onClick={() => setOpen(!open)}
        >
          {plural(indexes.filter(isLive).length, ['index', 'indexes'])} ·{' '}
          {plural(checks.length, ['check', 'checks'])}
        </button>
        {unmodeled.length > 0 && (
          <span title={extra.names} className="ml-auto truncate">
            {extra.text}
          </span>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col border-t border-border py-1">
          <ul aria-label="Indexes">
            {indexes.map((index) => (
              <IndexEntry key={index.id} index={index} />
            ))}
          </ul>
          <ul aria-label="Constraints">
            {constraints.map((constraint) => (
              <ConstraintEntry key={constraint.id} constraint={constraint} />
            ))}
          </ul>
          {adding === 'index' && <IndexEditor tableId={table.id} />}
          {adding === 'check' && <CheckEditor tableId={table.id} />}
          {editable && adding === null && (
            <div className="flex gap-1 px-2 pt-1">
              <Button size="xs" variant="ghost" onClick={() => add('index')}>
                <PlusIcon /> Index
              </Button>
              <Button size="xs" variant="ghost" onClick={() => add('check')}>
                <PlusIcon /> Check
              </Button>
            </div>
          )}
        </div>
      )}
    </footer>
  );
}
