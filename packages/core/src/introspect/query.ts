export type QueryParam = string | number | boolean | null;

/** Runs one statement on one connection and returns its rows. Core never talks to a driver directly. */
export type Query = <Row>(
  sql: string,
  params?: readonly QueryParam[],
) => Promise<Row[]>;

/**
 * Runs `fn` in one read-only REPEATABLE READ transaction, so every query inside sees the same
 * moment, and with an empty `search_path`, so `pg_get_expr` and `format_type` return fully
 * qualified names. `query` must be a single connection that nothing else uses meanwhile.
 */
export async function withSnapshot<T>(
  query: Query,
  fn: () => Promise<T>,
): Promise<T> {
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await query(`SET LOCAL search_path = ''`);
    const result = await fn();
    await query('COMMIT');
    return result;
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}
