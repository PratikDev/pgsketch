import { sameSet } from '../model/lookup';
import type { Constraint, SchemaModel } from '../model/types';
import { sameConstraintDefinition } from './constraints';
import { needsRebuild } from './fk-type-changes';
import { sameIndexDefinition } from './indexes';
import type { DiffPart } from './ops';

type Fk = Extract<Constraint, { kind: 'fk' }>;

/** Whether the key is still there, unchanged: a dropped or changed one is dropped and added again. */
function keysLost(
  fk: Fk,
  baseline: SchemaModel,
  desired: SchemaModel,
): boolean {
  const covers = (columnIds: string[]) => sameSet(columnIds, fk.refColumnIds);
  const lostConstraint = Object.values(baseline.constraints).some((k) => {
    const after = desired.constraints[k.id];
    return (
      k.tableId === fk.refTableId &&
      (k.kind === 'pk' || k.kind === 'unique') &&
      covers(k.columnIds) &&
      (!after || !sameConstraintDefinition(k, after))
    );
  });
  const lostIndex = Object.values(baseline.indexes).some((i) => {
    const after = desired.indexes[i.id];
    return (
      i.tableId === fk.refTableId &&
      i.unique &&
      covers(i.columnIds) &&
      (!after || !sameIndexDefinition(i, after))
    );
  });
  return lostConstraint || lostIndex;
}

/**
 * A foreign key that stays as it is, but whose primary key or unique key goes away or is rebuilt
 * (for example a primary key swapped for a unique constraint on the same column). Postgres won't
 * drop a key while a foreign key uses it, so the foreign key is dropped before and added again
 * after the new key exists. A key that still covers it, a foreign key already rebuilt for its
 * types, and one whose table or column is gone, need nothing here.
 */
export function diffFkKeyChanges(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const part: DiffPart = { ops: [], errors: [] };
  for (const before of Object.values(baseline.constraints)) {
    const after = desired.constraints[before.id];
    if (
      before.kind !== 'fk' ||
      after?.kind !== 'fk' ||
      !sameConstraintDefinition(before, after) ||
      needsRebuild(before, baseline, desired) ||
      // a target that is gone altogether is dropped as a dangling key instead
      !desired.tables[before.refTableId] ||
      before.refColumnIds.some((id) => !desired.columns[id])
    )
      continue;
    if (keysLost(before, baseline, desired)) {
      part.ops.push(
        { kind: 'dropConstraint', constraint: before },
        { kind: 'addConstraint', constraint: after },
      );
    }
  }
  return part;
}
