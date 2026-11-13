// Shared club-data cache for Ask AI (and, later, the club page). One entry per club + platform, the SAME for every
// user (it holds EA data only, nothing about who asked). An entry younger than CACHE_TTL_SEC is served without
// touching EA; an older or missing one is fetched live, through the same visitor / global / breaker gate as the
// public pages, and stored. Pure rules here: the database, the gate and EA are injected so the whole flow is testable.
import type { CaptureResult } from "./club-capture";
import { PROFILE_PARTS } from "./public-data";

/** How long a fetched club is reused by everybody (user decision: about 15 minutes). */
export const CACHE_TTL_SEC = 900;
/** Refuse to store anything bigger than this (same ceiling as a capture). */
export const MAX_CACHED_BYTES = 2_000_000;

export interface CacheRow {
  capture: CaptureResult;
  /** When the data was fetched from EA. */
  fetchedAt: Date;
}

export type ClubDataResult =
  | { ok: true; capture: CaptureResult; fetchedAt: Date; source: "cache" | "ea" }
  | { ok: false; error: "refused" | "blocked" | "ea_error" | "not_found" | "too_large"; retryAfterSec?: number };

export interface ClubCacheDeps {
  read(clubId: string, platform: string): Promise<CacheRow | null>;
  write(clubId: string, platform: string, capture: CaptureResult, fetchedAt: Date): Promise<void>;
  /** Charges the gate for one live fetch (`PROFILE_PARTS.length` EA calls). */
  admit(calls: number): Promise<{ ok: true } | { ok: false; reason: "breaker" | "visitor" | "global"; retryAfterSec: number }>;
  capture(clubId: string, platform: string): Promise<CaptureResult>;
  openBreaker(): Promise<void>;
  now(): Date;
}

export const isFresh = (fetchedAt: Date, now: Date): boolean => {
  const age = (now.getTime() - fetchedAt.getTime()) / 1000;
  // A negative age (clock skew) is treated as fresh-but-suspicious only up to the TTL; anything older than the TTL is stale.
  return age < CACHE_TTL_SEC;
};

/** Cached club data if fresh, otherwise a gated live fetch that is stored for the next asker. */
export async function getClubData(deps: ClubCacheDeps, clubId: string, platform: string): Promise<ClubDataResult> {
  const hit = await deps.read(clubId, platform);
  if (hit && isFresh(hit.fetchedAt, deps.now())) return { ok: true, capture: hit.capture, fetchedAt: hit.fetchedAt, source: "cache" };

  // A cache hit costs EA nothing, so the gate is only charged for a real fetch.
  const gate = await deps.admit(PROFILE_PARTS.length);
  if (!gate.ok) return { ok: false, error: "refused", retryAfterSec: gate.retryAfterSec };

  const cap = await deps.capture(clubId, platform);
  if (cap.blocked) {
    await deps.openBreaker();
    return { ok: false, error: "blocked" };
  }
  const st = cap.summary.statuses;
  const failed = PROFILE_PARTS.filter((k) => st[k] === "failed").length;
  // Nothing usable and nothing failed = EA does not know this club. Anything failed = EA trouble, never "no such club".
  if (cap.okCount === 0 || (st.clubInfo !== "ok" && st.overallStats !== "ok")) return { ok: false, error: failed > 0 ? "ea_error" : "not_found" };
  if (cap.summary.bytes > MAX_CACHED_BYTES) return { ok: false, error: "too_large" };

  // A fetch with a failed part is still useful to this asker but must not be shared for 15 minutes as if it were complete.
  const fetchedAt = deps.now();
  if (failed === 0) await deps.write(clubId, platform, cap, fetchedAt);
  return { ok: true, capture: cap, fetchedAt, source: "ea" };
}

export interface LoadOutcomeOk {
  ok: true;
  clubs: Array<{ id: string; label: string; createdAt: string; clubId: string; platform: string; data: unknown }>;
  fetchedFromEa: number;
}

/**
 * Loads 1 to 4 clubs for one question. Clubs are fetched ONE AT A TIME, so a block stops everything straight away
 * and the burst on EA stays small. The first failure ends the load (nothing partial is analysed).
 */
export async function loadClubsForAnalysis(
  deps: ClubCacheDeps,
  refs: ReadonlyArray<{ clubId: string; platform: string }>,
): Promise<LoadOutcomeOk | { ok: false; error: "refused" | "blocked" | "ea_error" | "not_found" | "too_large"; retryAfterSec?: number; clubId?: string }> {
  const clubs: LoadOutcomeOk["clubs"] = [];
  let fetchedFromEa = 0;
  for (const ref of refs) {
    const r = await getClubData(deps, ref.clubId, ref.platform);
    if (!r.ok) return { ...r, clubId: ref.clubId };
    if (r.source === "ea") fetchedFromEa++;
    // The id is the club + platform: there is one entry per club now, and compareClubs keys on it.
    clubs.push({
      id: `${ref.clubId}:${ref.platform}`,
      label: `Club ${ref.clubId}`,
      createdAt: r.fetchedAt.toISOString(),
      clubId: ref.clubId,
      platform: ref.platform,
      // Round-trip through JSON so the comparison sees plain data, exactly as it would from the database.
      data: JSON.parse(JSON.stringify(r.capture.payload)),
    });
  }
  return { ok: true, clubs, fetchedFromEa };
}

// ------------------------------------------------------------------------------------------------ refresh now

/** A club fetched less than this many seconds ago is not fetched again, so refreshing cannot be used to hammer EA. */
export const REFRESH_MIN_AGE_SEC = 60;
/** Club refreshes one signed-in user may trigger per hour (each one is five EA calls). Not refunded when EA fails. */
export const REFRESH_PER_HOUR = 20;

export type RefreshResult =
  /** Fetched from EA and stored for everyone. */
  | { result: "refreshed"; fetchedAt: Date; clubName: string | null }
  /** The cached copy is younger than REFRESH_MIN_AGE_SEC, so nothing was fetched. */
  | { result: "too_recent"; fetchedAt: Date; clubName: string | null; retryAfterSec: number }
  /** Our own limits (this user's hourly refreshes, or the shared EA ceiling). Nothing was fetched. */
  | { result: "limit" | "busy"; fetchedAt: Date | null; clubName: string | null; retryAfterSec: number }
  /** EA answered but an answer with a failed part is never stored, so the older copy (if any) is kept. */
  | { result: "kept_old"; fetchedAt: Date | null; clubName: string | null }
  | { result: "blocked" | "ea_error" | "not_found" | "too_large"; fetchedAt: Date | null; clubName: string | null }
  /** Not attempted because an earlier club in the same request was blocked or refused. */
  | { result: "skipped"; fetchedAt: Date | null; clubName: string | null };

export interface RefreshDeps extends ClubCacheDeps {
  /** Counts one refresh against this user's hourly allowance. */
  consumeRefresh(): Promise<{ ok: boolean; retryAfterSec: number }>;
}

const nameOf = (hit: CacheRow | null): string | null => hit?.capture.summary.clubName ?? null;

/**
 * Forces a live fetch of one club, bypassing the 15-minute window, and stores it for everybody. It is a refresh, not a
 * replacement: an answer with a failed part is never stored, so a good cached copy is never swapped for a worse one.
 * Order matters, cheapest check first: too recent (free) -> this user's hourly allowance -> the shared EA gate -> EA.
 */
export async function refreshClubData(deps: RefreshDeps, clubId: string, platform: string): Promise<RefreshResult> {
  const hit = await deps.read(clubId, platform);
  if (hit) {
    const age = (deps.now().getTime() - hit.fetchedAt.getTime()) / 1000;
    // age under the minimum, including a negative age from clock skew, counts as too recent
    if (age < REFRESH_MIN_AGE_SEC) return { result: "too_recent", fetchedAt: hit.fetchedAt, clubName: nameOf(hit), retryAfterSec: Math.min(REFRESH_MIN_AGE_SEC, Math.ceil(REFRESH_MIN_AGE_SEC - age)) };
  }
  const base = { fetchedAt: hit?.fetchedAt ?? null, clubName: nameOf(hit) };

  const mine = await deps.consumeRefresh();
  if (!mine.ok) return { result: "limit", ...base, retryAfterSec: mine.retryAfterSec };
  const gate = await deps.admit(PROFILE_PARTS.length);
  if (!gate.ok) return { result: "busy", ...base, retryAfterSec: gate.retryAfterSec };

  const cap = await deps.capture(clubId, platform);
  if (cap.blocked) {
    await deps.openBreaker();
    return { result: "blocked", ...base };
  }
  const st = cap.summary.statuses;
  const failed = PROFILE_PARTS.filter((k) => st[k] === "failed").length;
  // same rules as a normal load: nothing usable and nothing failed = no such club; anything failed = EA trouble
  if (cap.okCount === 0 || (st.clubInfo !== "ok" && st.overallStats !== "ok")) return { result: failed > 0 ? "ea_error" : "not_found", ...base };
  if (cap.summary.bytes > MAX_CACHED_BYTES) return { result: "too_large", ...base };
  if (failed > 0) return { result: "kept_old", ...base };

  const fetchedAt = deps.now();
  await deps.write(clubId, platform, cap, fetchedAt);
  return { result: "refreshed", fetchedAt, clubName: cap.summary.clubName };
}

/**
 * Refreshes 1 to 4 clubs ONE AT A TIME. A block, this user's limit or the shared ceiling stops everything at once: the
 * clubs after it are reported as skipped and EA is not asked again (a block is never retried or worked around).
 */
export async function refreshClubs(deps: RefreshDeps, refs: ReadonlyArray<{ clubId: string; platform: string }>): Promise<Array<RefreshResult & { clubId: string; platform: string }>> {
  const out: Array<RefreshResult & { clubId: string; platform: string }> = [];
  let stop = false;
  for (const ref of refs) {
    if (stop) {
      out.push({ result: "skipped", fetchedAt: null, clubName: null, ...ref });
      continue;
    }
    const r = await refreshClubData(deps, ref.clubId, ref.platform);
    out.push({ ...r, ...ref });
    if (r.result === "blocked" || r.result === "limit" || r.result === "busy") stop = true;
  }
  return out;
}
