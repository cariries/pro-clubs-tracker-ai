// Database-backed pieces of the public-page protection, built on the existing shared counter (rate_limit table),
// so no new migration is needed. The circuit breaker is just a row whose "window" is the cool-down period.
import { sql } from "drizzle-orm";
import { rateLimits } from "../db/schema";
import { getDb } from "./db";
import { dbRateLimit } from "./rate-limit-db";
import { BREAKER_KEY, PUBLIC_LIMITS, type GateDeps } from "./public-limit";

type Db = Pick<ReturnType<typeof getDb>, "select" | "insert">;

/** Opens the breaker now. Re-opening while open simply restarts the cool-down. */
export async function openBreaker(db: Db = getDb()): Promise<void> {
  await db
    .insert(rateLimits)
    .values({ key: BREAKER_KEY, count: 1 })
    .onConflictDoUpdate({ target: rateLimits.key, set: { windowStart: sql`now()`, count: 1 } });
}

/** Whether the breaker is open, and for how many more seconds. */
export async function breakerState(db: Db = getDb()): Promise<{ open: boolean; retryAfterSec: number }> {
  const rows = await db
    .select({
      secondsLeft: sql<number>`CEIL(${PUBLIC_LIMITS.breakerSeconds} - EXTRACT(EPOCH FROM (now() - ${rateLimits.windowStart})))::int`,
    })
    .from(rateLimits)
    .where(sql`${rateLimits.key} = ${BREAKER_KEY}`);
  const left = rows[0]?.secondsLeft;
  return typeof left === "number" && left > 0 ? { open: true, retryAfterSec: left } : { open: false, retryAfterSec: 0 };
}

/** The real gate dependencies (shared database counters). */
export function realGate(db: Db = getDb()): GateDeps {
  return {
    hit: (key, limit, windowSec) => dbRateLimit(key, limit, windowSec),
    breakerOpen: () => breakerState(db),
  };
}
