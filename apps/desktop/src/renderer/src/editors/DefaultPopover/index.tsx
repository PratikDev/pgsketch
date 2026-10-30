import type { NormalizedExpression } from '@pgsketch/core';
import { useMemo, useState } from 'react';
import type { ColumnView } from '@/canvas/model-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExpressionInput } from '@/editors/ExpressionInput';
import { cn } from '@/lib/utils';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { uiStore, useUiStore } from '@/stores/ui';
import { applyDefault } from './apply-default';
import { constantExpression, presetsFor } from './presets';
import { useTableColumns } from './use-table-columns';

// the default keeps room to be read and clicked: the type gives way before it does
const chip = 'min-w-14 shrink justify-start truncate';

/**
 * The default of a column, as the chip on its row. For a column that can be edited the chip opens a
 * popover: the defaults for its type, a constant to type, or any expression (read by Postgres as it
 * is typed). A column with no default shows a faint "+ default" while the row is hovered. An
 * identity column has no default and can't have one, so it shows nothing.
 */
export function DefaultPopover({
  column,
  editable,
}: {
  column: ColumnView;
  editable: boolean;
}) {
  const key = `${column.id}:default`;
  const open = useUiStore((s) => s.editing === key);
  const columns = useTableColumns(column.tableId);
  const enums = useSchemaStore((s) => s.baseline.enums);
  const schemas = useSchemaStore((s) => s.baseline.schemas);
  const enumLabels = useMemo(
    () =>
      Object.values(enums)
        .filter(
          (e) =>
            e.name === column.pgType.name &&
            schemas[e.schemaId]?.name === column.pgType.schema,
        )
        .flatMap((e) => e.labels),
    [enums, schemas, column.pgType],
  );
  const [constant, setConstant] = useState('');
  const [custom, setCustom] = useState(column.default ?? '');
  const [answer, setAnswer] = useState<NormalizedExpression | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (column.default === null && (!editable || column.identity)) return null;
  if (!editable)
    return (
      <Badge
        variant="outline"
        title={`Default: ${column.default}`}
        className={chip}
      >
        = {column.default}
      </Badge>
    );

  const close = () => uiStore.getState().stopEditing(key);
  const set = async (
    value: Parameters<typeof applyDefault>[2],
  ): Promise<void> => {
    const reason = await applyDefault(column.id, columns, value);
    setProblem(reason);
    if (reason === null) close();
  };
  const ready =
    answer?.status === 'normalized' || answer?.status === 'raw' ? answer : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) uiStore.getState().startEditing(key);
        else {
          close();
          setProblem(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Badge
          asChild
          variant="outline"
          className={cn(
            chip,
            column.default === null &&
              'hidden group-hover/row:inline-flex group-focus-within/row:inline-flex data-[state=open]:inline-flex text-muted-foreground',
          )}
        >
          <button
            type="button"
            className="nodrag"
            title={
              column.default === null
                ? 'Add a default'
                : `Default: ${column.default}`
            }
            aria-label={
              column.default === null
                ? 'Add a default'
                : `Default: ${column.default}`
            }
          >
            {column.default === null ? '+ default' : `= ${column.default}`}
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="nodrag nopan nowheel w-80 gap-2">
        <Tabs defaultValue="presets">
          <TabsList>
            <TabsTrigger value="presets">Presets</TabsTrigger>
            <TabsTrigger value="constant">Constant</TabsTrigger>
            <TabsTrigger value="custom">Expression</TabsTrigger>
          </TabsList>
          <TabsContent value="presets" className="flex flex-col gap-1">
            {presetsFor(column.pgType, enumLabels).map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                size="sm"
                className="justify-start font-mono"
                onClick={() =>
                  void set({
                    kind: 'preset',
                    preset: p.id,
                    expression: p.expression,
                  })
                }
              >
                {p.label}
              </Button>
            ))}
            {presetsFor(column.pgType, enumLabels).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No presets for this type. Type a constant or an expression.
              </p>
            )}
          </TabsContent>
          <TabsContent value="constant" className="flex flex-col gap-2">
            <Input
              aria-label="Constant"
              value={constant}
              onChange={(e) => setConstant(e.target.value)}
              className="nodrag nopan"
            />
            <Button
              size="sm"
              disabled={constant.trim() === ''}
              onClick={() =>
                void set({
                  kind: 'constant',
                  expression: constantExpression(column.pgType, constant),
                })
              }
            >
              Set default
            </Button>
          </TabsContent>
          <TabsContent value="custom" className="flex flex-col gap-2">
            <ExpressionInput
              label="Expression"
              value={custom}
              onChange={setCustom}
              target={{ kind: 'default', columnId: column.id }}
              columns={columns}
              onAnswer={setAnswer}
              placeholder="now() + interval '1 day'"
            />
            <Button
              size="sm"
              disabled={ready === null}
              onClick={() =>
                ready &&
                void set({ kind: 'expression', expression: ready.expression })
              }
            >
              Set default
            </Button>
          </TabsContent>
        </Tabs>
        {problem && (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        )}
        {column.default !== null && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              schemaStore.getState().setColumnDefault(column.id, null);
              close();
            }}
          >
            Remove default
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
