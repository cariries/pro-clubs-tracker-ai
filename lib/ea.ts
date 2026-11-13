// EA Pro Clubs endpoint allowlist. Paths were confirmed by the user in a browser on 2026-11-11 (HTTP 200).
// Response bodies have NOT been inspected yet, so no response types exist here. Do not invent them.
// Never add evasion (spoofed headers etc.). If EA returns a block page, stop and tell the user.

export const EA_BASE = "https://proclubs.ea.com/api/fc/";
export const PLATFORMS = ["common-gen5", "common-gen4", "nx"] as const;
// friendlyMatch comes from the proclubs-sdk docs and is untested against EA by us.
export const MATCH_TYPES = ["leagueMatch", "playoffMatch", "friendlyMatch"] as const;

type ParamKind = "clubIds" | "clubId" | "clubName" | "matchType" | "maxResultCount";

export interface EndpointDef {
  path: string;
  /** Required query params (platform is always required too). */
  params: ParamKind[];
  /** Query params the caller may omit. */
  optional?: ParamKind[];
}

// Key = public name used in /api/ea/[endpoint]. Value = EA path and EA's own param names.
export const ENDPOINTS: Record<string, EndpointDef> = {
  search: { path: "allTimeLeaderboard/search", params: ["clubName"] },
  clubInfo: { path: "clubs/info", params: ["clubIds"] },
  overallStats: { path: "clubs/overallStats", params: ["clubIds"] },
  memberStats: { path: "members/stats", params: ["clubId"] },
  memberCareerStats: { path: "members/career/stats", params: ["clubId"] },
  // maxResultCount (1-10) is from the proclubs-sdk; the SDK's default is 10. Untested against EA by us.
  matches: { path: "clubs/matches", params: ["clubIds", "matchType"], optional: ["maxResultCount"] },
  // Documented by the community proclubs-sdk (user-reported 2026-11-11), NOT yet verified against EA.
  // Note the singular "club/" in the first path, as documented.
  playoffAchievements: { path: "club/playoffAchievements", params: ["clubId"] },
  currentSeasonLeaderboard: { path: "currentSeasonLeaderboard", params: [] },
  searchCurrentSeason: { path: "currentSeasonLeaderboard/search", params: ["clubName"] },
  // From the proclubs-sdk routes (rankingsAllTime), NOT yet tried against EA by us. Response shape assumed
  // to match `search`/the leaderboard; no sample exists.
  allTimeLeaderboard: { path: "allTimeLeaderboard", params: [] },
};

export const ID_RE = /^\d{1,12}$/;

export type ParseResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Validate caller input against the allowlist and build the EA URL. Rejects anything unexpected. */
export function buildEaUrl(endpoint: string, input: URLSearchParams): ParseResult {
  const def = Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
  if (!def) return { ok: false, error: `unknown endpoint; allowed: ${Object.keys(ENDPOINTS).join(", ")}` };

  const platform = input.get("platform");
  if (!platform || !(PLATFORMS as readonly string[]).includes(platform)) {
    return { ok: false, error: `platform must be one of: ${PLATFORMS.join(", ")}` };
  }

  const out = new URLSearchParams({ platform });
  const all = [...def.params.map((p) => [p, true] as const), ...(def.optional ?? []).map((p) => [p, false] as const)];
  for (const [p, required] of all) {
    const v = input.get(p);
    if (!v) {
      if (required) return { ok: false, error: `missing param: ${p}` };
      continue;
    }
    if (p === "maxResultCount") {
      const n = Number(v);
      if (!/^\d{1,2}$/.test(v) || n < 1 || n > 10) {
        return { ok: false, error: "maxResultCount must be an integer from 1 to 10" };
      }
    } else if (p === "clubIds" || p === "clubId") {
      if (!ID_RE.test(v)) return { ok: false, error: `${p} must be a numeric id` };
    } else if (p === "matchType") {
      if (!(MATCH_TYPES as readonly string[]).includes(v)) {
        return { ok: false, error: `matchType must be one of: ${MATCH_TYPES.join(", ")}` };
      }
    } else if (p === "clubName") {
      if (v.length > 50) return { ok: false, error: "clubName too long (max 50)" };
    }
    out.set(p, v);
  }
  return { ok: true, url: `${EA_BASE}${def.path}?${out}` };
}

export const BLOCK_PATTERN = /access (blocked|denied)|forbidden|request blocked|akamai|reference #/i;
