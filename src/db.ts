/**
 * Thin typed wrappers over the D1 binding. No ORM — each domain module writes its own SQL.
 * `bind(...)` params are positional `?` placeholders.
 */
export const db = {
  async all<T>(d1: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
    const { results } = await d1.prepare(sql).bind(...params).all<T>();
    return results ?? [];
  },

  async first<T>(d1: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
    return (await d1.prepare(sql).bind(...params).first<T>()) ?? null;
  },

  async run(d1: D1Database, sql: string, ...params: unknown[]): Promise<void> {
    await d1.prepare(sql).bind(...params).run();
  },

  /** Runs statements in one D1 batch (atomic). Each entry is [sql, params]. */
  async batch(d1: D1Database, statements: [string, unknown[]][]): Promise<void> {
    if (statements.length === 0) return;
    await d1.batch(statements.map(([sql, p]) => d1.prepare(sql).bind(...p)));
  },
};
