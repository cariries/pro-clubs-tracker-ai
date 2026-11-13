import { auth, authConfigured } from "@/auth";
import { describeUnexpected } from "@/lib/errors";
import { fetchEa } from "@/lib/ea-fetch";
import { REFRESH_PER_HOUR, refreshClubs, type RefreshDeps } from "@/lib/club-cache";
import { readClubCache, writeClubCache } from "@/lib/club-cache-db";
import { captureClub } from "@/lib/club-capture";
import { PROFILE_PARTS } from "@/lib/public-data";
import { admitPublic } from "@/lib/public-limit";
import { openBreaker, realGate } from "@/lib/public-db";
import { dbRateLimit } from "@/lib/rate-limit-db";
import { validateRefreshInput } from "@/lib/refresh-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to 4 clubs one after another, five parallel EA calls each. One minute is the Vercel Hobby ceiling.
export const maxDuration = 60;

/**
 * "Refresh now": fetch the chosen clubs from EA again, ignoring the 15-minute window, and store them for everybody. Needs
 * a login. Limited per user per hour, never more than once a minute per club, and charged to the same shared EA gate as
 * every other fetch. It never calls the AI, so it costs no tokens.
 */
export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    const ref = Date.now().toString(36);
    const info = describeUnexpected(err);
    console.error(`[refresh] unexpected error ref=${ref} code=${info.code ?? "none"} cause="${info.cause}" error="${info.summary}"`);
    return Response.json({ error: "internal_error", ref, code: info.code }, { status: 500 });
  }
}

async function handle(req: Request): Promise<Response> {
  if (!authConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request", message: "body must be JSON" }, { status: 400 });
  }
  const input = validateRefreshInput(body);
  if (!input.ok) return Response.json({ error: "bad_request", message: input.error }, { status: 400 });

  const safeId = userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const gate = realGate();
  const deps: RefreshDeps = {
    read: (clubId, platform) => readClubCache(clubId, platform),
    write: (clubId, platform, cap, at) => writeClubCache(clubId, platform, cap, at),
    // the same shared gate as the public pages and Ask AI, charged per user (not per shared IP)
    admit: (calls) => admitPublic(gate, `user:${safeId}`, calls),
    capture: (clubId, platform) => captureClub(clubId, platform, { fetchEa: (e, p) => fetchEa(e, p, { timeoutMs: 8_000 }) }, new Date(), PROFILE_PARTS),
    openBreaker: () => openBreaker(),
    now: () => new Date(),
    // this user's own hourly allowance for refreshes (a separate key from AI questions)
    consumeRefresh: async () => {
      const r = await dbRateLimit(`refresh:${safeId}`, REFRESH_PER_HOUR, 3600);
      return { ok: r.ok, retryAfterSec: r.retryAfterSec };
    },
  };

  const results = await refreshClubs(deps, input.clubs);
  // Times go out as ISO text; nothing about the club's data is returned (the page reloads it from the cache).
  return Response.json({
    results: results.map((r) => ({
      clubId: r.clubId,
      platform: r.platform,
      result: r.result,
      clubName: r.clubName,
      fetchedAt: r.fetchedAt ? r.fetchedAt.toISOString() : null,
      ...("retryAfterSec" in r ? { retryAfterSec: r.retryAfterSec } : {}),
    })),
    limitPerHour: REFRESH_PER_HOUR,
  });
}
