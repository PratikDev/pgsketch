import { toast } from 'sonner';

/**
 * Says why something the user did was refused, as an error toast; does nothing for `null`, which is
 * what the store's actions return when they went through. The message is the toast's id, so the
 * same refusal over and over shows one toast, not a pile of them.
 */
export function showRefusal(reason: string | null): void {
  if (reason) toast.error(reason, { id: reason });
}
