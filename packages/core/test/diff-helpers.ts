import type { DiffPart } from '../src/diff/ops';
import type { SchemaModel } from '../src/model/types';
import { fixtureModel } from './fixtures/model';

/** An edit to the model under test. */
export type Change = (model: SchemaModel) => void;

/** The fixture as the baseline and a copy with `change` applied as the edited model. */
export function edit(change: Change): {
  baseline: SchemaModel;
  desired: SchemaModel;
} {
  const baseline: SchemaModel = fixtureModel;
  const desired: SchemaModel = structuredClone(fixtureModel);
  change(desired);
  return { baseline, desired };
}

/** Like `edit`, but the baseline is changed first too; the edited model starts from that baseline. */
export function editBoth(
  changeBaseline: (baseline: SchemaModel) => void,
  change: (desired: SchemaModel) => void,
): { baseline: SchemaModel; desired: SchemaModel } {
  const baseline: SchemaModel = structuredClone(fixtureModel);
  changeBaseline(baseline);
  const desired: SchemaModel = structuredClone(baseline);
  change(desired);
  return { baseline, desired };
}

/** Runs one diff part on the fixture after `change`. */
export const partRunner =
  (part: (baseline: SchemaModel, desired: SchemaModel) => DiffPart) =>
  (change: Change): DiffPart => {
    const { baseline, desired } = edit(change);
    return part(baseline, desired);
  };

export const opKinds = (part: DiffPart): string[] =>
  part.ops.map((o) => o.kind);
