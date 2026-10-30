import type {
  ExpressionColumn,
  ExpressionTarget,
  NormalizedExpression,
} from '@pgsketch/core';
import { Input } from '@/components/ui/input';
import { useNormalizedExpression } from './use-normalized-expression';

/**
 * A SQL expression to type (a default, or a check), which Postgres reads 400 ms after the typing
 * stops: its own error is shown under the input, and `onAnswer` gets its canonical form (for a
 * check, with the columns it uses).
 */
export function ExpressionInput({
  label,
  value,
  onChange,
  target,
  columns,
  onAnswer,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  target: ExpressionTarget;
  columns: ExpressionColumn[];
  onAnswer?: (answer: NormalizedExpression) => void;
  placeholder?: string;
}) {
  const state = useNormalizedExpression(
    { expression: value, target, columns },
    onAnswer,
  );
  const answer = state.status === 'done' ? state.answer : null;
  const error =
    state.status === 'failed'
      ? `Couldn't check the expression: ${state.message}`
      : answer?.status === 'invalid'
        ? answer.message
        : null;
  const stored =
    answer?.status === 'normalized' && answer.expression !== value.trim()
      ? answer.expression
      : null;
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={label}
        aria-invalid={error !== null || undefined}
        aria-busy={state.status === 'pending'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        // typing here must not drag the table or pan the canvas
        className="nodrag nopan font-mono md:text-sm"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {stored && (
        <p className="truncate text-xs text-muted-foreground" title={stored}>
          Stored as <code>{stored}</code>
        </p>
      )}
    </div>
  );
}
