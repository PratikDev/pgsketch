import { CheckIcon, CircleIcon, XIcon } from 'lucide-react';
import type { StatementResult } from '../../../shared/ipc-contract';

const failed = (r: StatementResult) => r.status === 'failed';

/**
 * What the dry run found, one line for each statement in the order they ran: passed, failed with
 * the error Postgres gave and its code, or not run because an earlier one failed.
 */
export function ValidateResults({
  statements,
  results,
}: {
  statements: string[];
  results: StatementResult[];
}) {
  const problem = results.findIndex(failed);
  return (
    <section
      aria-label="Validation results"
      className="flex h-full w-96 shrink-0 flex-col border-l border-border"
    >
      <p
        role="status"
        className="border-b border-border px-3 py-2 text-sm font-medium"
      >
        {problem === -1
          ? `All ${results.length} ${results.length === 1 ? 'statement' : 'statements'} passed. Nothing was kept.`
          : `Statement ${problem + 1} of ${results.length} failed. Nothing was kept.`}
      </p>
      <ol className="min-h-0 flex-1 overflow-auto">
        {results.map((result, i) => (
          <li
            key={i}
            data-status={result.status}
            className="flex gap-2 border-b border-border px-3 py-2 text-sm"
          >
            <span className="mt-0.5 shrink-0">
              {result.status === 'passed' && (
                <CheckIcon className="size-4 text-added" aria-label="Passed" />
              )}
              {result.status === 'failed' && (
                <XIcon
                  className="size-4 text-destructive"
                  aria-label="Failed"
                />
              )}
              {result.status === 'not-run' && (
                <CircleIcon
                  className="size-4 text-muted-foreground"
                  aria-label="Not run"
                />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <code className="block truncate font-mono text-xs">
                {statements[i]}
              </code>
              {result.status === 'failed' && (
                <p role="alert" className="mt-1 text-destructive">
                  {result.message}
                  {result.code !== null && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({result.code})
                    </span>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
