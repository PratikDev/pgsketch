import type { Schema } from '@pgsketch/core';
import { useMemo } from 'react';
import { unionOf } from '@/canvas/model-view';
import { useSchemaStore } from '@/stores/schema';

/** The schemas of the database and of the edits together, by name. */
export function useSchemas(): Schema[] {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  return useMemo(
    () =>
      Object.values(unionOf(baseline, desired).schemas).sort((a, b) =>
        a.name < b.name ? -1 : 1,
      ),
    [baseline, desired],
  );
}
