import type { TableView } from '@/canvas/model-view';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SchemaRenameInput,
  SchemaRowActions,
  whileRenaming,
} from '@/editors/SchemaRowActions';
import { useSchemas } from '@/hooks/use-schemas';
import { showRefusal } from '@/lib/refusal';
import { schemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';

/**
 * The schema of a table, before its dot. For a table that is already in the database it is plain
 * text, since it can't move; for one the migration creates it is a menu of the schemas, with "New
 * schema…", which makes one, moves the table there and opens its name to be typed. A schema the
 * migration creates has a pen and a trash can in its row.
 */
export function SchemaPicker({ table }: { table: TableView }) {
  const schemas = useSchemas();
  const editing = useUiStore((s) => s.editing);
  const renaming = schemas.some((s) => editing === `${s.id}:name`);

  if (table.state.status?.status !== 'added')
    return <span className="text-muted-foreground">{table.schema}.</span>;

  const idle = renaming ? whileRenaming : {};

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label="Schema"
          className="nodrag h-6 px-1 font-normal text-muted-foreground"
        >
          {table.schema}.
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuRadioGroup
          value={table.schemaId}
          onValueChange={(schemaId) =>
            showRefusal(
              schemaStore.getState().setTableSchema(table.id, schemaId),
            )
          }
        >
          {schemas.map((schema) =>
            editing === `${schema.id}:name` ? (
              <SchemaRenameInput key={schema.id} schema={schema} />
            ) : (
              <DropdownMenuRadioItem
                key={schema.id}
                value={schema.id}
                {...idle}
              >
                {schema.name}
                <SchemaRowActions schema={schema} />
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          {...idle}
          // the menu stays open, so the name of the new schema can be typed in its row
          onSelect={(event) => {
            event.preventDefault();
            const schemaId = schemaStore.getState().addSchema();
            showRefusal(
              schemaStore.getState().setTableSchema(table.id, schemaId),
            );
            uiStore.getState().startEditing(`${schemaId}:name`);
          }}
        >
          New schema…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
