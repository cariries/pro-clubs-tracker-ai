// The clubs chosen for an Ask AI question live in the page URL (?clubs=914493.common-gen5,123.nx): no storage, no
// per-user table, bookmarkable. Everything read from a URL is untrusted, so it is validated and capped here.
import { MAX_CLUBS } from "./club-compare";
import { isClubId, isPublicPlatform } from "./public-clubs";

export interface AskClub {
  clubId: string;
  platform: string;
}

const key = (c: AskClub) => `${c.clubId}.${c.platform}`;

/** Parses the `clubs` URL value. Invalid entries are dropped, duplicates collapse, at most MAX_CLUBS are kept. */
export function parseAskClubs(raw: unknown): AskClub[] {
  if (typeof raw !== "string") return [];
  const out: AskClub[] = [];
  const seen = new Set<string>();
  for (const part of raw.slice(0, 400).split(",")) {
    const i = part.indexOf(".");
    if (i < 1) continue;
    const clubId = part.slice(0, i);
    const platform = part.slice(i + 1);
    if (!isClubId(clubId) || !isPublicPlatform(platform) || seen.has(`${clubId}.${platform}`)) continue;
    seen.add(`${clubId}.${platform}`);
    out.push({ clubId, platform });
    if (out.length === MAX_CLUBS) break;
  }
  return out;
}

export const formatAskClubs = (clubs: readonly AskClub[]): string => clubs.map(key).join(",");

/** The Ask AI page with these clubs chosen. */
export function askPath(clubs: readonly AskClub[]): string {
  return clubs.length === 0 ? "/analysis" : `/analysis?clubs=${encodeURIComponent(formatAskClubs(clubs))}`;
}

/** Adds a club. Returns the new list, and whether it was actually added (false when already there or the list is full). */
export function addAskClub(clubs: readonly AskClub[], add: AskClub): { clubs: AskClub[]; added: boolean; full: boolean } {
  if (clubs.some((c) => key(c) === key(add))) return { clubs: [...clubs], added: false, full: false };
  if (clubs.length >= MAX_CLUBS) return { clubs: [...clubs], added: false, full: true };
  return { clubs: [...clubs, add], added: true, full: false };
}

export const removeAskClub = (clubs: readonly AskClub[], drop: AskClub): AskClub[] => clubs.filter((c) => key(c) !== key(drop));

// ------------------------------------------------------------------------------------------------ data age

/** What the page shows about a chosen club's data: its name and how long ago EA was last asked (null = never cached). */
export interface ClubInfo {
  name: string | null;
  /** ISO time the data was fetched from EA, or null if it is not cached yet. */
  fetchedAt: string | null;
}

/** "3 min ago" in words, from a number of whole seconds. Returns the unit and amount so each language words it. */
export function ageParts(seconds: number): { unit: "now" | "min" | "hour" | "day"; n: number } {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (s < 60) return { unit: "now", n: 0 };
  if (s < 3600) return { unit: "min", n: Math.floor(s / 60) };
  if (s < 86_400) return { unit: "hour", n: Math.floor(s / 3600) };
  return { unit: "day", n: Math.floor(s / 86_400) };
}

/** Whole seconds between a stored ISO time and now; null when there is no usable time. A future time counts as 0. */
export function ageSeconds(fetchedAt: string | null | undefined, nowMs: number): number | null {
  if (!fetchedAt) return null;
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

// ------------------------------------------------------------------------------------------------ refresh wording

export interface RefreshOutcomeView {
  clubId: string;
  platform: string;
  result: string;
  clubName?: string | null;
  fetchedAt?: string | null;
  retryAfterSec?: number;
}

/** Reads the refresh route's answer without trusting it. Anything unexpected is dropped, never shown. */
export function readRefreshResponse(body: unknown): { results: RefreshOutcomeView[]; limitPerHour: number | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const { results, limitPerHour } = body as Record<string, unknown>;
  if (!Array.isArray(results)) return null;
  const out: RefreshOutcomeView[] = [];
  for (const r of results) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.clubId !== "string" || typeof o.platform !== "string" || typeof o.result !== "string") continue;
    out.push({
      clubId: o.clubId,
      platform: o.platform,
      result: o.result,
      clubName: typeof o.clubName === "string" ? o.clubName : null,
      fetchedAt: typeof o.fetchedAt === "string" ? o.fetchedAt : null,
      retryAfterSec: typeof o.retryAfterSec === "number" && Number.isFinite(o.retryAfterSec) && o.retryAfterSec >= 0 ? Math.min(o.retryAfterSec, 86_400) : undefined,
    });
  }
  return { results: out, limitPerHour: typeof limitPerHour === "number" && Number.isFinite(limitPerHour) && limitPerHour > 0 ? limitPerHour : null };
}

/** The result codes the refresh route can return (and the page knows how to word). */
export const REFRESH_RESULTS = ["refreshed", "too_recent", "limit", "busy", "kept_old", "blocked", "ea_error", "not_found", "too_large", "skipped"] as const;
export const isRefreshResult = (v: string): boolean => (REFRESH_RESULTS as readonly string[]).includes(v);
