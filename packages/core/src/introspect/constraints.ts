import { columnId, constraintId, tableId } from '../model/ids';
import type { Oid } from '../model/ids';
import type { Constraint, FkAction, Id, ReadOnlyReason } from '../model/types';
import { indexReasonSql } from './indexes';
import type { Query } from './query';
import { tableReasonSql, userTableSql } from './tables';

export interface ConstraintRow {
  oid: Oid;
  table_oid: Oid;
  name: string;
  kind: 'p' | 'u' | 'c' | 'f' | 'x';
  key_attnums: number[] | null;
  ref_table_oid: Oid;
  ref_attnums: number[] | null;
  del_action: ActionCode;
  upd_action: ActionCode;
  match_type: string;
  deferrable: boolean;
  validated: boolean;
  no_inherit: boolean;
  /** Postgres 15+: `ON DELETE SET NULL (col, ...)`. */
  has_set_columns: boolean;
  check_expr: string | null;
  definition: string;
  table_reason: ReadOnlyReason | null;
  index_reason: ReadOnlyReason | null;
}

type ActionCode = 'a' | 'r' | 'c' | 'n' | 'd';

const ACTIONS: Record<ActionCode, FkAction> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

/** Turns one catalog row into a constraint, deciding whether pgsketch can edit it. */
export function toConstraint(row: ConstraintRow): Constraint {
  const columnIds = (row.key_attnums ?? []).map((n) =>
    columnId(row.table_oid, n),
  );
  const keyReason =
    row.kind === 'p' || row.kind === 'u' ? row.index_reason : null;
  const readOnly: ReadOnlyReason | undefined =
    row.table_reason ??
    (row.kind === 'x' ? 'exclusion' : undefined) ??
    (row.deferrable ? 'deferrable' : undefined) ??
    (!row.validated ? 'not-valid' : undefined) ??
    // only checks can be inherited; Postgres flags every other kind as non-inheritable
    (row.kind === 'c' && row.no_inherit ? 'no-inherit' : undefined) ??
    (row.kind === 'f' && row.match_type === 'f' ? 'match-full' : undefined) ??
    (row.kind === 'f' && row.has_set_columns ? 'fk-set-columns' : undefined) ??
    keyReason ??
    undefined;
  const base = {
    id: constraintId(row.oid),
    tableId: tableId(row.table_oid),
    name: row.name,
    columnIds,
    ...(readOnly && { readOnly, definition: row.definition }),
  };
  switch (row.kind) {
    case 'p':
      return { ...base, kind: 'pk' };
    case 'u':
      return { ...base, kind: 'unique' };
    case 'c':
      return { ...base, kind: 'check', expression: row.check_expr ?? '' };
    case 'x':
      return { ...base, kind: 'exclusion' };
    case 'f':
      return {
        ...base,
        kind: 'fk',
        refTableId: tableId(row.ref_table_oid),
        refColumnIds: (row.ref_attnums ?? []).map((n): Id =>
          columnId(row.ref_table_oid, n),
        ),
        onDelete: ACTIONS[row.del_action],
        onUpdate: ACTIONS[row.upd_action],
      };
  }
}

export async function introspectConstraints(
  query: Query,
): Promise<Constraint[]> {
  // contype 'n' (Postgres 18 NOT NULL) and 't' (constraint triggers) are deliberately not selected:
  // NOT NULL comes from the column itself.
  const rows = await query<ConstraintRow>(
    `SELECT c.oid, c.conrelid AS table_oid, c.conname AS name, c.contype AS kind,
            c.conkey AS key_attnums, c.confrelid AS ref_table_oid, c.confkey AS ref_attnums,
            c.confdeltype AS del_action, c.confupdtype AS upd_action, c.confmatchtype AS match_type,
            c.condeferrable AS deferrable, c.convalidated AS validated, c.connoinherit AS no_inherit,
            to_jsonb(c) ->> 'confdelsetcols' IS NOT NULL AS has_set_columns,
            CASE WHEN c.contype = 'c' THEN pg_get_expr(c.conbin, c.conrelid) END AS check_expr,
            pg_get_constraintdef(c.oid) AS definition,
            ${tableReasonSql('t')} AS table_reason,
            ${indexReasonSql('x', 'ic', 'am')} AS index_reason
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       LEFT JOIN pg_index x ON x.indexrelid = c.conindid
       LEFT JOIN pg_class ic ON ic.oid = c.conindid
       LEFT JOIN pg_am am ON am.oid = ic.relam
      WHERE c.contype IN ('p', 'u', 'c', 'f', 'x') AND ${userTableSql('t')}
      ORDER BY c.conrelid, c.oid`,
  );
  return rows.map(toConstraint);
}
