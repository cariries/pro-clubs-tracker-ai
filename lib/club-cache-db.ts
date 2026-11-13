// Database side of the shared club cache (table club_cache). Shared by all users: no user id anywhere.
import { sql } from "drizzle-orm";
import { clubCache } from "../db/schema";
import { getDb } from "./db";
import type { CacheRow } from "./club-cache";
import type { CaptureResult } from "./club-capture";
import { PART_KEYS } from "./club-capture";

type Db = Pick<ReturnType<typeof getDb>, "select" | "insert">;

/** Reads the cached club, or null. A row whose stored shape is unusable counts as a miss, never an error. */
export async function readClubCache(clubId: string, platform: string, db: Db = getDb()): Promise<CacheRow | null> {
  const rows = await db
    .select({ data: clubCache.data, fetchedAt: clubCache.fetchedAt })
    .from(clubCache)
    .where(sql`${clubCache.clubId} = ${clubId} AND ${clubCache.platform} = ${platform}`)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const d = row.data as Partial<CaptureResult> | null;
  const statuses = d?.summary?.statuses;
  if (!d || typeof d !== "object" || !d.payload || !d.summary || !statuses || !PART_KEYS.every((k) => typeof statuses[k] === "string")) return null;
  return { capture: { payload: d.payload, summary: d.summary, blocked: false, okCount: typeof d.okCount === "number" ? d.okCount : 0 }, fetchedAt: row.fetchedAt };
}

/** Stores or overwrites the club's cached data (one row per club and platform). */
export async function writeClubCache(clubId: string, platform: string, capture: CaptureResult, fetchedAt: Date, db: Db = getDb()): Promise<void> {
  const data = { payload: capture.payload, summary: capture.summary, okCount: capture.okCount };
  await db
    .insert(clubCache)
    .values({ clubId, platform, data, fetchedAt })
    .onConflictDoUpdate({ target: [clubCache.clubId, clubCache.platform], set: { data, fetchedAt } });
}
