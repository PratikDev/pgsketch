import type { SchemaModel } from '../src/model/types';
import { fixtureModel } from './fixtures/model';

/** The fixture as the baseline and a copy with `change` applied as the edited model. */
export function edit(change: (desired: SchemaModel) => void): {
  baseline: SchemaModel;
  desired: SchemaModel;
} {
  const baseline: SchemaModel = fixtureModel;
  const desired: SchemaModel = structuredClone(fixtureModel);
  change(desired);
  return { baseline, desired };
}
