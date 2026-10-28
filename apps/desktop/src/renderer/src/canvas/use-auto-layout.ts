import type { SchemaModel } from '@pgsketch/core';
import { useEffect, useState } from 'react';
import { autoLayout, type LayoutLink } from '@/layout/autoLayout';
import { layoutStore, useLayoutStore } from '@/stores/layout';
import type { TableView } from './model-view';

export type LayoutStatus = 'pending' | 'ready' | 'failed';

/** The foreign keys as links between rows, for the layout. */
function linksOf(model: SchemaModel): LayoutLink[] {
  return Object.values(model.constraints).flatMap((key): LayoutLink[] => {
    const from = key.kind === 'fk' ? key.columnIds[0] : undefined;
    const to = key.kind === 'fk' ? key.refColumnIds[0] : undefined;
    if (key.kind !== 'fk' || from === undefined || to === undefined) return [];
    return [
      {
        id: key.id,
        fromTable: key.tableId,
        fromColumn: from,
        toTable: key.refTableId,
        toColumn: to,
      },
    ];
  });
}

/**
 * Puts the tables that have no saved position somewhere, with the auto-layout (which runs in a
 * worker): the whole graph is laid out and only the new tables take their place, so a table that
 * is already somewhere stays there. It waits until the saved positions have been read. Until it
 * answers, and if it can't, those tables are left to the caller's fallback.
 */
export function useAutoLayout(
  model: SchemaModel,
  views: TableView[],
): LayoutStatus {
  const positions = useLayoutStore((s) => s.positions);
  const loaded = useLayoutStore((s) => s.loaded);
  const [failed, setFailed] = useState(false);
  const missing = views.filter((v) => !positions[v.id]).map((v) => v.id);

  useEffect(() => {
    if (!loaded || missing.length === 0 || failed) return;
    let current = true;
    autoLayout(
      views.map((v) => ({ id: v.id, columnIds: v.columns.map((c) => c.id) })),
      linksOf(model),
    ).then(
      (laidOut) => {
        if (!current) return;
        const wanted = new Set(missing);
        layoutStore
          .getState()
          .place(
            Object.fromEntries(
              Object.entries(laidOut).filter(([id]) => wanted.has(id)),
            ),
          );
      },
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
    // only when a table without a position appears, not on every edit of what is already placed
  }, [loaded, missing.join(), failed]);

  return failed
    ? 'failed'
    : !loaded || missing.length > 0
      ? 'pending'
      : 'ready';
}
