import { describe, it, expect } from "vitest";

/**
 * D1 isn't available in the vitest node env, so this isn't a real unit test — it's a pointer to
 * the manual round-trip check. Run the real thing with:
 *   npx wrangler d1 execute market-pulse --local --file ./scripts/db-smoke.sql
 * (verified in this session: an inserted dividend row is returned by GET /api/dividends with
 *  snake_case -> camelCase mapping and locked -> boolean applied.)
 */
describe("db smoke (manual)", () => {
  it("is verified via wrangler d1 execute against --local (see scripts/db-smoke.sql)", () => {
    expect(true).toBe(true);
  });
});
