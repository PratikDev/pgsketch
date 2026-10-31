/** What to show of anything that was thrown. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
