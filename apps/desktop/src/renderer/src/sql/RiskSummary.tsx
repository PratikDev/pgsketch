import { RISK_LABELS, type Risk, type RiskLevel } from '@pgsketch/core';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';

const LEVELS = Object.keys(RISK_LABELS) as RiskLevel[];

/**
 * What could go wrong with the migration, counted by kind ("2 may fail"), each count opening into
 * the list of what it is about. The destructive ones are red.
 */
export function RiskSummary({ risks }: { risks: Risk[] }) {
  const [open, setOpen] = useState<RiskLevel[]>([]);
  const toggle = (level: RiskLevel) =>
    setOpen((o) =>
      o.includes(level) ? o.filter((l) => l !== level) : [...o, level],
    );
  const found = LEVELS.map((level) => ({
    level,
    messages: risks.filter((r) => r.level === level).map((r) => r.message),
  })).filter((l) => l.messages.length > 0);

  if (found.length === 0)
    return <p className="text-sm text-muted-foreground">No risks found.</p>;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <ul aria-label="Risks" className="flex flex-wrap gap-2">
        {found.map(({ level, messages }) => (
          <li key={level}>
            <Badge
              asChild
              variant={level === 'destructive' ? 'destructive' : 'secondary'}
            >
              <button
                type="button"
                aria-expanded={open.includes(level)}
                onClick={() => toggle(level)}
              >
                {messages.length} {RISK_LABELS[level]}
              </button>
            </Badge>
          </li>
        ))}
      </ul>
      {found
        .filter(({ level }) => open.includes(level))
        .map(({ level, messages }) => (
          <ul
            key={level}
            aria-label={`Risks: ${RISK_LABELS[level]}`}
            className="list-disc pl-5"
          >
            {messages.map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>
        ))}
    </div>
  );
}
