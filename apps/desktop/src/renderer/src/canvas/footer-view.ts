import type {
  Constraint,
  Id,
  ReadOnlyReason,
  SchemaModel,
  UnmodeledKind,
} from '@pgsketch/core';
import { stateOf, type ObjectState, type StateSources } from './object-state';

export interface IndexView {
  id: Id;
  name: string;
  /** The names of its columns, in the order of the index. */
  columns: string[];
  unique: boolean;
  /** What Postgres says it is, for a read-only index. */
  definition: string | null;
  state: ObjectState;
}

/** A check, or any other constraint pgsketch can't edit (an exclusion constraint, a deferrable key…). */
export interface ConstraintView {
  id: Id;
  name: string;
  kind: Constraint['kind'];
  expression: string | null;
  definition: string | null;
  state: ObjectState;
}

/** An object pgsketch does not edit that depends on the table. */
export interface UnmodeledView {
  kind: UnmodeledKind;
  name: string;
}

/** What the footer of a table node shows: its indexes, its checks and read-only constraints, and what depends on it. */
export interface FooterView {
  indexes: IndexView[];
  constraints: ConstraintView[];
  unmodeled: UnmodeledView[];
}

export const UNMODELED_LABELS: Record<UnmodeledKind, [string, string]> = {
  view: ['view', 'views'],
  'materialized-view': ['materialized view', 'materialized views'],
  'foreign-table': ['foreign table', 'foreign tables'],
  sequence: ['sequence', 'sequences'],
  trigger: ['trigger', 'triggers'],
  function: ['function', 'functions'],
  policy: ['policy', 'policies'],
};

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function footerOf(
  model: SchemaModel,
  tableId: Id,
  sources?: StateSources,
): FooterView {
  const columnName = (id: Id) => model.columns[id]?.name ?? id;
  const named = <T extends { id: Id; name: string }>(
    object: T,
    from?: Record<Id, { name: string }>,
  ) => from?.[object.id]?.name ?? object.name;
  const state = (id: Id, readOnly?: ReadOnlyReason) =>
    stateOf(id, readOnly, sources);

  return {
    indexes: Object.values(model.indexes)
      .filter((i) => i.tableId === tableId)
      .map((i) => ({
        id: i.id,
        name: named(i, sources?.named?.indexes),
        columns: i.columnIds.map(columnName),
        unique: i.unique,
        definition: i.definition ?? null,
        state: state(i.id, i.readOnly),
      }))
      .sort(byName),
    constraints: Object.values(model.constraints)
      .filter(
        (c) => c.tableId === tableId && (c.kind === 'check' || c.readOnly),
      )
      .map((c) => ({
        id: c.id,
        name: named(c, sources?.named?.constraints),
        kind: c.kind,
        expression: c.kind === 'check' ? c.expression : null,
        definition: c.definition ?? null,
        state: state(c.id, c.readOnly),
      }))
      .sort(byName),
    // a sequence behind an identity or serial column is the column's own
    unmodeled: Object.values(model.unmodeled)
      .filter((u) => u.tableIds.includes(tableId) && u.kind !== 'sequence')
      .map(({ kind, name }) => ({ kind, name }))
      .sort(byName),
  };
}
