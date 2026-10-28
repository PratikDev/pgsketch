import { useMemo } from 'react';
import { unionOf } from '@/canvas/model-view';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSchemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';

/** Which schemas have their tables drawn on the canvas. */
export function SchemaFilter() {
  const baseline = useSchemaStore((s) => s.baseline);
  const desired = useSchemaStore((s) => s.desired);
  const hidden = useUiStore((s) => s.hiddenSchemas);
  const schemas = useMemo(
    () =>
      Object.values(unionOf(baseline, desired).schemas).sort((a, b) =>
        a.name < b.name ? -1 : 1,
      ),
    [baseline, desired],
  );
  const shown = schemas.filter((s) => !hidden.includes(s.id)).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          Schemas ({shown}/{schemas.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {schemas.map((schema) => (
          <DropdownMenuCheckboxItem
            key={schema.id}
            checked={!hidden.includes(schema.id)}
            // the menu stays open, so several schemas can be toggled in one go
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => uiStore.getState().toggleSchema(schema.id)}
          >
            {schema.name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={hidden.length === 0}
          onSelect={() => uiStore.getState().showAllSchemas()}
        >
          Show all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
