import { fkTypesCompatible } from '../model/fk-types';
import type { Constraint, SchemaModel } from '../model/types';
import { samePgType } from '../sql/pgtype';
import { sameConstraintDefinition } from './constraints';
import type { ChangeOp, DiffPart } from './ops';

type Fk = Extract<Constraint, { kind: 'fk' }>;

/**
 * When both columns of a foreign key change type in one migration, the two `ALTER COLUMN TYPE`
 * statements can't run at the same moment: whichever runs first leaves the key between the old
 * and new types. If Postgres can't compare those two types, that step fails, so the key is
 * dropped before and added again after. If it can (`integer` to `bigint` on both sides) or only
 * one side changes, Postgres rebuilds the key itself and nothing extra is needed. A key that
 * changed in another way is already dropped and added again by the constraint diff.
 */
export function diffFkTypeChanges(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const ops: ChangeOp[] = [];
  for (const before of Object.values(baseline.constraints)) {
    const after = desired.constraints[before.id];
    if (
      before.kind !== 'fk' ||
      after?.kind !== 'fk' ||
      !sameConstraintDefinition(before, after)
    )
      continue;
    if (needsRebuild(before, baseline, desired)) {
      ops.push(
        { kind: 'dropConstraint', constraint: before },
        { kind: 'addConstraint', constraint: after },
      );
    }
  }
  return { ops, errors: [] };
}

function needsRebuild(
  before: Fk,
  baseline: SchemaModel,
  desired: SchemaModel,
): boolean {
  return before.columnIds.some((fkId, i) => {
    const keyId = before.refColumnIds[i];
    if (keyId === undefined) return false; // a foreign key with fewer referenced columns is reported by validation
    const fkOld = baseline.columns[fkId]?.type;
    const keyOld = baseline.columns[keyId]?.type;
    const fkNew = desired.columns[fkId]?.type;
    const keyNew = desired.columns[keyId]?.type;
    if (!fkOld || !keyOld || !fkNew || !keyNew) return false;
    if (samePgType(fkOld, fkNew) || samePgType(keyOld, keyNew)) return false; // not both sides
    return (
      !fkTypesCompatible(fkNew, keyOld) || !fkTypesCompatible(fkOld, keyNew)
    );
  });
}
