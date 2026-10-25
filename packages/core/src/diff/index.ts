import type { SchemaModel } from '../model/types';
import { diffColumns } from './columns';
import { diffComments } from './comments';
import { diffConstraints } from './constraints';
import { diffFkKeyChanges } from './fk-keys';
import { diffFkTypeChanges } from './fk-type-changes';
import { diffIndexes } from './indexes';
import type { ChangeOp, DiffPart } from './ops';
import { guardReadOnly } from './readonly-guard';
import { diffSchemas } from './schemas';
import { diffTables } from './tables';

/**
 * Backstop for foreign keys that point at a table or column that is gone. The editor removes
 * them together with the table or column, so they are normally already dropped by the constraint
 * diff; one that is still in the edited model would be dropped silently by Postgres, so it gets an
 * explicit drop here.
 */
function diffDanglingForeignKeys(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const ops: ChangeOp[] = [];
  for (const before of Object.values(baseline.constraints)) {
    if (
      before.kind !== 'fk' ||
      !desired.constraints[before.id] ||
      !desired.tables[before.tableId]
    )
      continue;
    const targetGone =
      !desired.tables[before.refTableId] ||
      before.refColumnIds.some((id) => !desired.columns[id]);
    if (targetGone) ops.push({ kind: 'dropConstraint', constraint: before });
  }
  return { ops, errors: [] };
}

/**
 * Everything that has to change to turn the loaded schema (`baseline`) into the edited one
 * (`desired`), found by comparing objects by id, plus the edits that must block SQL generation.
 * The result is in no particular order; the migration renderer puts it in phases.
 */
export function diff(baseline: SchemaModel, desired: SchemaModel): DiffPart {
  const parts = [
    diffSchemas,
    diffTables,
    diffColumns,
    diffConstraints,
    diffFkTypeChanges,
    diffFkKeyChanges,
    diffDanglingForeignKeys,
    diffIndexes,
    diffComments,
  ].map((part) => part(baseline, desired));
  const guarded = guardReadOnly(
    baseline,
    desired,
    parts.flatMap((p) => p.ops),
  );
  return {
    ops: guarded.ops,
    errors: [...parts.flatMap((p) => p.errors), ...guarded.errors],
  };
}
