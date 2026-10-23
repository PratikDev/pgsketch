import type { SchemaModel } from '../model/types';
import type { DiffPart } from './ops';

/**
 * New schemas are created. Renaming or dropping an existing one isn't possible in 0.1.0, so the
 * editor never does it; if it happens anyway it must block generation rather than be dropped silently.
 */
export function diffSchemas(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const part: DiffPart = { ops: [], errors: [] };
  for (const schema of Object.values(desired.schemas)) {
    if (!baseline.schemas[schema.id])
      part.ops.push({ kind: 'createSchema', schema });
  }
  for (const before of Object.values(baseline.schemas)) {
    const after = desired.schemas[before.id];
    if (!after || after.name !== before.name) {
      part.errors.push({
        code: 'schema-changed',
        objectId: before.id,
        message: `Schema "${before.name}" can't be renamed or dropped yet`,
      });
    }
  }
  return part;
}
