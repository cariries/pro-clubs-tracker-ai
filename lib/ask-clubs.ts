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
