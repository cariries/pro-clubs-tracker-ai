// Protection for the PUBLIC pages, which anonymous visitors can use without logging in. Every public page view
// can cause calls to EA (which is picky about clients and may block us), so three layers apply:
//  1. a per-visitor limit (by IP) so one person cannot hammer us,
//  2. a GLOBAL ceiling on EA calls per minute across all visitors, so a crowd cannot get us blocked either,
//  3. a circuit breaker: when EA looks blocked, public pages stop calling EA for a while.
// Pure rules live here; the database-backed counters are in lib/rate-limit-db.ts. Logged-in features have their
// own, separate limits (lib/llm: the daily AI limit).
export const PUBLIC_LIMITS = {
  /** Public EA-calling page views per visitor per minute. */
  perVisitor: { limit: 20, windowSec: 60 },
  /** Calls from the public pages to EA per minute across ALL visitors. */
  globalEa: { limit: 120, windowSec: 60 },
  /** After EA looks blocked, public pages do not call EA for this long. */
  breakerSeconds: 300,
} as const;

/** A search is one EA call; a club profile is this many (info, totals, members, career, league matches). tests/public.test.ts pins it to PROFILE_PARTS. */
export const EA_CALLS = { search: 1, profile: 5 } as const;

export const BREAKER_KEY = "public:ea-blocked";

/**
 * Best-effort client address from request headers. On Vercel `x-forwarded-for` is set by the platform; elsewhere a
 * client could forge it, so this is only as trustworthy as the host in front of the app. Returns "unknown" if absent
 * (all such visitors then share one bucket, which errs on the strict side).
 */
export function clientKey(headers: { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  const raw = xff || real || "unknown";
  // Keep keys short and printable; an attacker-controlled header must not become an unbounded database key.
  return raw.replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45) || "unknown";
}

export type PublicGate =
  | { ok: true }
  | { ok: false; reason: "breaker" | "visitor" | "global"; retryAfterSec: number };

export interface GateDeps {
  /** Counts a hit on a key; returns whether it is still within `limit` in the window. */
  hit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfterSec: number }>;
  /** True while the circuit breaker is open. */
  breakerOpen(): Promise<{ open: boolean; retryAfterSec: number }>;
}

/**
 * Decides whether a public page may call EA now. Order matters: the breaker is checked first and costs nothing,
 * then the per-visitor limit (so one noisy visitor cannot use up the global budget), then the global budget
 * (charged `calls` units, because a profile costs several EA calls).
 */
export async function admitPublic(deps: GateDeps, visitor: string, calls: number): Promise<PublicGate> {
  const b = await deps.breakerOpen();
  if (b.open) return { ok: false, reason: "breaker", retryAfterSec: b.retryAfterSec };

  const v = await deps.hit(`public:visitor:${visitor}`, PUBLIC_LIMITS.perVisitor.limit, PUBLIC_LIMITS.perVisitor.windowSec);
  if (!v.ok) return { ok: false, reason: "visitor", retryAfterSec: v.retryAfterSec };

  for (let i = 0; i < calls; i++) {
    const g = await deps.hit("public:global-ea", PUBLIC_LIMITS.globalEa.limit, PUBLIC_LIMITS.globalEa.windowSec);
    if (!g.ok) return { ok: false, reason: "global", retryAfterSec: g.retryAfterSec };
  }
  return { ok: true };
}
