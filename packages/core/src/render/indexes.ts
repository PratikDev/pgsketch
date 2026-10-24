import type { ChangeOp } from '../diff/ops';
import type { ModelPair } from '../model/types';
import { qualified, quoteIdent } from '../sql/quote';
import { columnName, schemaName, tableRef } from './names';

type IndexOp = Extract<
  ChangeOp,
  { kind: 'addIndex' | 'renameIndex' | 'dropIndex' }
>;

/** Dropping runs before the renames and uses the loaded schema; the other two use the edited one. */
export function renderIndexOp(op: IndexOp, models: ModelPair): string[] {
  switch (op.kind) {
    case 'addIndex': {
      const columns = op.index.columnIds
        .map((id) => quoteIdent(columnName(models, id)))
        .join(', ');
      return [
        `CREATE ${op.index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(op.index.name)} ON ${tableRef(models, op.index.tableId)} (${columns})`,
      ];
    }
    case 'renameIndex': {
      const tableId = models.desired.indexes[op.indexId]?.tableId;
      const table = tableId && models.desired.tables[tableId];
      if (!table) throw new Error(`Unknown index ${op.indexId}`);
      return [
        `ALTER INDEX ${qualified(schemaName(models, table.schemaId), op.from)} RENAME TO ${quoteIdent(op.to)}`,
      ];
    }
    case 'dropIndex': {
      const table = models.baseline.tables[op.index.tableId];
      if (!table) throw new Error(`Unknown table ${op.index.tableId}`);
      return [
        `DROP INDEX ${qualified(schemaName(models, table.schemaId), op.index.name)}`,
      ];
    }
  }
}
