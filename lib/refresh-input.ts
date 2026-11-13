// Input for the "Refresh now" request: 1 to 4 clubs, validated exactly like the clubs of an Ask AI question (a numeric
// club id and a platform EA still serves). Kept apart from the route so it is testable without a server.
import { MAX_CLUBS } from "./club-compare";
import { isClubId, isPublicPlatform } from "./public-clubs";

export interface RefreshRef {
  clubId: string;
  platform: string;
}

export type RefreshInput = { ok: true; clubs: RefreshRef[] } | { ok: false; error: string };

export function validateRefreshInput(body: unknown): RefreshInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const { clubs } = body as Record<string, unknown>;
  if (!Array.isArray(clubs)) return { ok: false, error: "clubs must be a list of 1 to 4 clubs" };
  const seen = new Set<string>();
  const out: RefreshRef[] = [];
  for (const c of clubs) {
    const o = typeof c === "object" && c !== null ? (c as Record<string, unknown>) : null;
    if (!o || !isClubId(o.clubId) || !isPublicPlatform(o.platform)) return { ok: false, error: "each club needs a numeric clubId and a platform (common-gen5 or nx)" };
    const key = `${o.clubId}:${o.platform}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ clubId: o.clubId, platform: o.platform });
    }
  }
  if (out.length < 1) return { ok: false, error: "choose at least 1 club" };
  if (out.length > MAX_CLUBS) return { ok: false, error: `choose at most ${MAX_CLUBS} clubs` };
  return { ok: true, clubs: out };
}
