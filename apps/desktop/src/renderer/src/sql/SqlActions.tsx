import type { Migration } from '@pgsketch/core';
import { CheckIcon, CopyIcon, DatabaseZapIcon, SaveIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { migrationFileName } from '../../../shared/file-name';
import type { Validation } from './use-validate';
import { messageOf } from '@/lib/errors';

/** How long "Copied" stays on the button. */
const COPIED_MS = 1_500;

/** Copy, Save and Validate for the SQL that is on show. */
export function SqlActions({
  migration,
  validation,
}: {
  migration: Migration;
  validation: Validation;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(migration.text);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch (error) {
      toast.error(`Couldn't copy the SQL: ${messageOf(error)}`);
    }
  };

  const save = async () => {
    try {
      const result = await api.sql.save({
        text: migration.text,
        suggestedName: migrationFileName(new Date()),
      });
      if (result.status === 'saved') toast.success(`Saved ${result.path}`);
    } catch (error) {
      toast.error(`Couldn't save the SQL: ${messageOf(error)}`);
    }
  };

  return (
    <div className="flex shrink-0 gap-2">
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button variant="outline" size="sm" onClick={() => void save()}>
        <SaveIcon />
        Save
      </Button>
      <Button
        size="sm"
        disabled={validation.running}
        onClick={() => void validation.request(migration)}
      >
        <DatabaseZapIcon />
        {validation.running ? 'Validating…' : 'Validate'}
      </Button>
    </div>
  );
}
