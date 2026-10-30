import type { ExpressionColumn, Id } from '@pgsketch/core';
import { useMemo } from 'react';
import { useSchemaStore } from '@/stores/schema';

/** Every column of a table as it is being edited, pending ones too: what an expression may refer to. */
export function useTableColumns(tableId: Id): ExpressionColumn[] {
  const columns = useSchemaStore((s) => s.desired.columns);
  return useMemo(
    () =>
      Object.values(columns)
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.position - b.position)
        .map(({ id, name, type }) => ({ id, name, type })),
    [columns, tableId],
  );
}
