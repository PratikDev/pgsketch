import { Badge } from '@/components/ui/badge';
import type { ColumnView } from './model-view';

/** One column of a table: its name, type, what it is (PK, NN, UQ), its default and where it points. */
export function ColumnRow({ column }: { column: ColumnView }) {
  return (
    <li className="flex items-center gap-2 px-3 py-1 text-sm">
      <span className="font-medium">{column.name}</span>
      <span className="text-muted-foreground">{column.type}</span>
      <span className="ml-auto flex items-center gap-1">
        {column.default !== null && (
          <Badge variant="outline" title="Default">
            = {column.default}
          </Badge>
        )}
        {column.references.map((target) => (
          <Badge key={target} variant="outline" title="Foreign key">
            → {target}
          </Badge>
        ))}
        {column.primaryKey && <Badge variant="secondary">PK</Badge>}
        {column.notNull && <Badge variant="secondary">NN</Badge>}
        {column.unique && <Badge variant="secondary">UQ</Badge>}
      </span>
    </li>
  );
}
