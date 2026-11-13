import { NextResponse } from "next/server";
import { fetchEa } from "@/lib/ea-fetch";
import { addAskClub, askPath, formatAskClubs, parseAskClubs } from "@/lib/ask-clubs";
import { checkClubName, homePath, isPublicPlatform, profilePath, selectPath } from "@/lib/public-clubs";
import { clientKey, searchClubs } from "@/lib/public-data";
import { openBreaker, realGate } from "@/lib/public-db";
import { describeUnexpected } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The home page's search box submits here. Public: no login. One result goes straight to the club, several go to a
 * selection page, none goes back to the home page with a message. (A redirect, so the browser's back button works.)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url), 303);

  const name = checkClubName(url.searchParams.get("name"));
  const platform = url.searchParams.get("platform") ?? "";
  // Set when the search came from the Ask AI page: the chosen clubs so far, and the result is ADDED to them.
  const ask = parseAskClubs(url.searchParams.get("clubs"));
  const fromAsk = url.searchParams.has("clubs");
  if (!name.ok) return to(homePath(name.error, String(url.searchParams.get("name") ?? "").slice(0, 50), platform));
  if (!isPublicPlatform(platform)) return to(homePath("bad_platform", name.name));

  // The shared counters live in the database; without it the service cannot protect EA, so it refuses to call it.
  if (!process.env.DATABASE_URL) return to(homePath("unavailable", name.name, platform));

  try {
    const r = await searchClubs(
      { ...realGate(), openBreaker, fetchEa: (e, p) => fetchEa(e, p, { revalidate: 300 }) },
      clientKey(req.headers),
      name.name,
      platform,
    );
    if (r.kind === "refused") {
      const code = r.gate.reason === "breaker" ? "blocked" : "busy";
      return to(`${homePath(code, name.name, platform)}&retry=${r.gate.retryAfterSec}`);
    }
    if (r.kind === "ea_error") return to(homePath(r.blocked ? "blocked" : "ea", name.name, platform));
    if (r.outcome.kind === "none") return to(homePath("none", name.name, platform));
    if (r.outcome.kind === "one") {
      return to(fromAsk ? askPath(addAskClub(ask, { clubId: r.outcome.club.clubId, platform }).clubs) : profilePath(r.outcome.club.clubId, platform));
    }
    return to(`${selectPath(name.name, platform)}${fromAsk ? `&clubs=${encodeURIComponent(formatAskClubs(ask))}` : ""}`);
  } catch (err) {
    const ref = Date.now().toString(36);
    const info = describeUnexpected(err);
    console.error(`[search] unexpected error ref=${ref} code=${info.code ?? "none"} cause="${info.cause}" error="${info.summary}"`);
    return to(homePath("unavailable", name.name, platform));
  }
}
