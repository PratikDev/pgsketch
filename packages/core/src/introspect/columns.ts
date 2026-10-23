import { columnId, tableId } from '../model/ids';
import type { Column, PgType, ReadOnlyReason } from '../model/types';
import { parsePgType } from '../sql/pgtype';
import type { Query } from './query';
import { tableReasonSql, userTableSql } from './tables';

export interface ColumnRow {
  table_oid: number | string;
  attnum: number;
  name: string;
  type: string;
  not_null: boolean;
  default_expr: string | null;
  identity: '' | 'a' | 'd';
  generated: string;
  comment: string | null;
  table_reason: ReadOnlyReason | null;
  /** Postgres 18 stores NOT NULL as a constraint, which can be NOT VALID or NO INHERIT. */
  not_null_not_valid: boolean;
  not_null_no_inherit: boolean;
}

/** Turns one catalog row into a column, deciding whether pgsketch can edit it. */
export function toColumn(row: ColumnRow): Column {
  let type: PgType;
  let unsupportedType = false;
  try {
    type = parsePgType(row.type);
  } catch {
    // keep the text so the column can still be shown; it is read-only and never rendered
    type = { name: row.type, isArray: false };
    unsupportedType = true;
  }
  const readOnly: ReadOnlyReason | undefined =
    row.table_reason ??
    (row.generated !== '' ? 'generated-column' : undefined) ??
    (row.default_expr?.startsWith('nextval(')
      ? 'nextval-default'
      : undefined) ??
    (unsupportedType ? 'unsupported-type' : undefined) ??
    (row.not_null_not_valid ? 'not-null-not-valid' : undefined) ??
    (row.not_null_no_inherit ? 'not-null-no-inherit' : undefined);
  return {
    id: columnId(row.table_oid, row.attnum),
    tableId: tableId(row.table_oid),
    name: row.name,
    position: row.attnum,
    type,
    notNull: row.not_null,
    default:
      row.default_expr === null
        ? null
        : { kind: 'expression', expression: row.default_expr },
    identity:
      row.identity === 'a'
        ? 'always'
        : row.identity === 'd'
          ? 'byDefault'
          : null,
    comment: row.comment,
    ...(readOnly && { readOnly }),
  };
}

const notNullConstraint = (condition: string) =>
  `EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = a.attrelid AND k.contype = 'n'
     AND a.attnum = ANY (k.conkey) AND ${condition})`;

export async function introspectColumns(query: Query): Promise<Column[]> {
  const rows = await query<ColumnRow>(
    `SELECT a.attrelid AS table_oid, a.attnum, a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr,
            a.attidentity AS identity, a.attgenerated AS generated,
            col_description(a.attrelid, a.attnum) AS comment,
            ${tableReasonSql('t')} AS table_reason,
            ${notNullConstraint('NOT k.convalidated')} AS not_null_not_valid,
            ${notNullConstraint('k.connoinherit')} AS not_null_no_inherit
       FROM pg_attribute a
       JOIN pg_class t ON t.oid = a.attrelid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attnum > 0 AND NOT a.attisdropped AND ${userTableSql('t')}
      ORDER BY a.attrelid, a.attnum`,
  );
  return rows.map(toColumn);
}
