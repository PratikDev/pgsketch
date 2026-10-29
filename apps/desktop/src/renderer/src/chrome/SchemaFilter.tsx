import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SchemaRenameInput,
  SchemaRowActions,
  whileRenaming,
} from '@/editors/SchemaRowActions';
import { useSchemas } from '@/hooks/use-schemas';
import { uiStore, useUiStore } from '@/stores/ui';

/** Which schemas have their tables drawn on the canvas. */
export function SchemaFilter() {
  const schemas = useSchemas();
  const hidden = useUiStore((s) => s.hiddenSchemas);
  const editing = useUiStore((s) => s.editing);
  const idle = schemas.some((s) => editing === `${s.id}:name`)
    ? whileRenaming
    : {};
  const shown = schemas.filter((s) => !hidden.includes(s.id)).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          Schemas ({shown}/{schemas.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {schemas.map((schema) =>
          editing === `${schema.id}:name` ? (
            <SchemaRenameInput key={schema.id} schema={schema} />
          ) : (
            <DropdownMenuCheckboxItem
              key={schema.id}
              {...idle}
              checked={!hidden.includes(schema.id)}
              // the menu stays open, so several schemas can be toggled in one go
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => uiStore.getState().toggleSchema(schema.id)}
            >
              {schema.name}
              <SchemaRowActions schema={schema} />
            </DropdownMenuCheckboxItem>
          ),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          {...idle}
          disabled={hidden.length === 0}
          onSelect={() => uiStore.getState().showAllSchemas()}
        >
          Show all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
