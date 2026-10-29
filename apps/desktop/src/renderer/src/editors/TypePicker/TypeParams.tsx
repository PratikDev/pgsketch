import type { PgType } from '@pgsketch/core';
import { Input } from '@/components/ui/input';
import { paramsFrom, type BuiltinType } from './types';

/** One number input for each parameter of the type, like the length of a `varchar`; empty means none. */
export function TypeParams({
  builtin,
  value,
  onChange,
}: {
  builtin: BuiltinType;
  value: PgType;
  onChange: (type: PgType) => void;
}) {
  const set = (index: number, text: string) => {
    const values = builtin.params.map((_, i) => value.params?.[i]);
    values[index] = text === '' ? undefined : Number(text);
    const params = paramsFrom(values);
    onChange({
      name: value.name,
      ...(value.schema !== undefined && { schema: value.schema }),
      ...(params && { params }),
      isArray: value.isArray,
    });
  };
  return (
    <div className="flex gap-2">
      {builtin.params.map((label, i) => (
        <label key={label} className="flex flex-1 flex-col gap-1 text-xs">
          {label}
          <Input
            type="number"
            min={0}
            className="h-7 md:text-sm"
            value={value.params?.[i] ?? ''}
            onChange={(e) => set(i, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
