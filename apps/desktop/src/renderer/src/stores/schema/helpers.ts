import type { Id, SchemaModel } from '@pgsketch/core';

/** `base`, or the first of `base_2`, `base_3`, … that isn't taken. */
export function firstFree(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}_${n}`;
    if (!names.has(name)) return name;
  }
}

/** The position after the last column of a table. */
export const nextPosition = (model: SchemaModel, tableId: Id): number =>
  1 +
  Math.max(
    0,
    ...Object.values(model.columns)
      .filter((c) => c.tableId === tableId)
      .map((c) => c.position),
  );
