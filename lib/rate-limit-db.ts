// Per-key fixed-window rate limiter backed by Postgres, so the count is shared across serverless
// instances (the in-memory limiter in rate-limit.ts is not). One atomic upsert per hit: no transaction
// needed, which matters because the Neon HTTP driver has none.
import { sql } from "drizzle-orm";
import { rateLimits } from "../db/schema";
import { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

/** Builds the upsert. Exported separately so the generated SQL can be inspected without a database. */
export function buildRateLimitQuery(db: Db, key: string, windowSec: number) {
  if (!Number.isInteger(windowSec) || windowSec < 1 || windowSec > 86_400) {
    throw new Error("windowSec must be an integer from 1 to 86400");
  }
  // Inlined (validated integer above) so Postgres never has to infer a parameter type for the interval.
  const expired = sql`${rateLimits.windowStart} <= now() - interval '${sql.raw(String(windowSec))} seconds'`;
  return db
    .insert(rateLimits)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN now() ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
}

export async function dbRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; count: number; retryAfterSec: number }> {
  const [row] = await buildRateLimitQuery(getDb(), key, windowSec);
  if (!row) throw new Error("rate limit upsert returned no row");
  const elapsedSec = (Date.now() - row.windowStart.getTime()) / 1000;
  const retryAfterSec = Math.min(windowSec, Math.max(1, Math.ceil(windowSec - elapsedSec)));
  return { ok: row.count <= limit, count: row.count, retryAfterSec };
}
