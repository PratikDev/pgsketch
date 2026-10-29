import type { PgType } from '@pgsketch/core';
import { useMemo } from 'react';
import { useSchemaStore } from '@/stores/schema';

/** The enums of the database as column types, schema-qualified, in name order. Enums can't be edited in 0.1.0, so the loaded ones are all of them. */
export function useEnumTypes(): PgType[] {
  const enums = useSchemaStore((s) => s.baseline.enums);
  const schemas = useSchemaStore((s) => s.baseline.schemas);
  return useMemo(
    () =>
      Object.values(enums)
        .flatMap((e) => {
          const schema = schemas[e.schemaId]?.name;
          return schema === undefined
            ? []
            : [{ name: e.name, schema, isArray: false }];
        })
        .sort((a, b) =>
          `${a.schema}.${a.name}` < `${b.schema}.${b.name}` ? -1 : 1,
        ),
    [enums, schemas],
  );
}
