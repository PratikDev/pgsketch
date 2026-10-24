import type { ChangeOp } from '../diff/ops';
import type { ModelPair } from '../model/types';
import { qualified, quoteIdent } from '../sql/quote';
import { columnDefinition } from './columns';
import { schemaName, schemaOfExistingTable } from './names';

type TableOp = Extract<
  ChangeOp,
  { kind: 'createTable' | 'renameTable' | 'dropTable' }
>;

/**
 * A new table gets its columns and primary key in one statement and no foreign keys (they are
 * added once every table exists). Dropping has no CASCADE: whatever depended on the table was
 * dropped or blocked earlier, so a failure here means something was missed.
 */
export function renderTableOp(op: TableOp, models: ModelPair): string[] {
  switch (op.kind) {
    case 'createTable': {
      const names = new Map(op.columns.map((c) => [c.id, c.name]));
      const lines = op.columns.map(columnDefinition);
      if (op.pk) {
        const columns = op.pk.columnIds
          .map((id) => quoteIdent(names.get(id) ?? id))
          .join(', ');
        lines.push(
          `CONSTRAINT ${quoteIdent(op.pk.name)} PRIMARY KEY (${columns})`,
        );
      }
      const table = qualified(
        schemaName(models, op.table.schemaId),
        op.table.name,
      );
      return [
        `CREATE TABLE ${table} (\n${lines.map((l) => `  ${l}`).join(',\n')}\n)`,
      ];
    }
    case 'renameTable':
      return [
        `ALTER TABLE ${qualified(schemaOfExistingTable(models, op.tableId), op.from)} RENAME TO ${quoteIdent(op.to)}`,
      ];
    case 'dropTable':
      return [
        `DROP TABLE ${qualified(schemaName(models, op.table.schemaId), op.table.name)}`,
      ];
  }
}
