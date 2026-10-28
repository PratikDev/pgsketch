import {
  assessRisk,
  assignNames,
  diff,
  validateModel,
  type ChangeOp,
  type Risk,
  type SchemaModel,
  type ValidationError,
} from '@pgsketch/core';
import { useMemo } from 'react';
import { statusMapOf, type StatusMap } from '@/canvas/status';
import { useSchemaStore } from './schema';

export type OpRisk = Risk & { op: ChangeOp };

/** Everything worked out from the loaded schema and the edited one. */
export interface Derived {
  /** `desired` with the names the database would give new constraints and indexes. */
  named: SchemaModel;
  ops: ChangeOp[];
  /** What blocks generating SQL: validation errors, and edits the diff can't express. */
  errors: ValidationError[];
  risks: OpRisk[];
  statuses: StatusMap;
}

export function derive(baseline: SchemaModel, desired: SchemaModel): Derived {
  const named = assignNames(desired);
  const { ops, errors } = diff(baseline, named);
  return {
    named,
    ops,
    errors: [...validateModel(named), ...errors],
    risks: ops.flatMap((op) =>
      assessRisk(op, baseline).map((risk) => ({ ...risk, op })),
    ),
    statuses: statusMapOf(ops, baseline),
  };
}

// An edit makes a new `desired` and a load a new `baseline`, so a pair seen before has not changed.
const cache = new WeakMap<SchemaModel, WeakMap<SchemaModel, Derived>>();

/** `derive`, remembered for each pair of models, so it runs once per edit however many components ask. */
export function derived(baseline: SchemaModel, desired: SchemaModel): Derived {
  let byDesired = cache.get(baseline);
  if (!byDesired) cache.set(baseline, (byDesired = new WeakMap()));
  let result = byDesired.get(desired);
  if (!result) byDesired.set(desired, (result = derive(baseline, desired)));
  return result;
}

/** The derived diff of the schema store, recomputed only when `desired` or `baseline` changes. */
export function useDerived(): Derived {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  return useMemo(() => derived(baseline, desired), [baseline, desired]);
}
