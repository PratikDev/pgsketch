import { RISK_LABELS, type RiskLevel } from '@pgsketch/core';
import { useDerived } from '@/stores/derived';

const LEVELS = Object.keys(RISK_LABELS) as RiskLevel[];

/** How many changes the edits make, and how many of them are risky, by kind of risk: "5 changes · 1 destructive". */
export function ChangeCount() {
  const { ops, risks } = useDerived();
  return (
    <p
      aria-live="polite"
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
    >
      <span>
        {ops.length} {ops.length === 1 ? 'change' : 'changes'}
      </span>
      {LEVELS.flatMap((level) => {
        const count = risks.filter((r) => r.level === level).length;
        return count > 0
          ? [
              <span key={level}>
                · {count} {RISK_LABELS[level]}
              </span>,
            ]
          : [];
      })}
    </p>
  );
}
