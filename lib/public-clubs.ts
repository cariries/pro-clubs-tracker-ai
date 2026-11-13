// Pure logic for the public club pages: turning an EA search into "go to the club", "choose a club" or "nothing
// found", and shaping the public club profile. No network, no database, so everything here is unit-testable.
import { parseClubSearch, type ClubRecord } from "./ea-types";

export const SEARCH_NAME_MIN = 2;
export const SEARCH_NAME_MAX = 50;
/** The platforms a visitor can search. common-gen4 is rejected by EA since FC 27 (per the SDK's notes). */
export const PUBLIC_PLATFORMS = ["common-gen5", "nx"] as const;
export type PublicPlatform = (typeof PUBLIC_PLATFORMS)[number];
export const MAX_CHOICES = 20;

export const isPublicPlatform = (v: unknown): v is PublicPlatform => typeof v === "string" && (PUBLIC_PLATFORMS as readonly string[]).includes(v);

export type NameCheck = { ok: true; name: string } | { ok: false; error: "too_short" | "too_long" | "bad_characters" };

/** Normalises and validates what a visitor typed. Control characters are rejected; everything else is passed to EA as text. */
export function checkClubName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, error: "too_short" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < SEARCH_NAME_MIN) return { ok: false, error: "too_short" };
  if (name.length > SEARCH_NAME_MAX) return { ok: false, error: "too_long" };
  if (/[\u0000-\u001f\u007f<>]/.test(name)) return { ok: false, error: "bad_characters" };
  return { ok: true, name };
}

/** A club id from the URL: digits only, as EA uses. */
export const isClubId = (v: unknown): v is string => typeof v === "string" && /^\d{1,12}$/.test(v);

export type SearchOutcome =
  | { kind: "none" }
  | { kind: "one"; club: ClubRecord }
  | { kind: "many"; clubs: ClubRecord[]; total: number };

/**
 * TAKES EA'S RAW ROWS (with `clubName`), NOT rows that parseClubSearch already produced (those have `name`, and parsing
 * them again blanks every name: bug found 2026-11-13). Applies the agreed rule: no result = nothing found; exactly one = go straight to the club; several = choose.
 * Duplicates (the same club listed twice) count once. A single result is only trusted if it has a club id.
 */
export function decideSearch(rawEaRows: unknown): SearchOutcome {
  let clubs: ClubRecord[];
  try {
    clubs = parseClubSearch(rawEaRows);
  } catch {
    return { kind: "none" };
  }
  const seen = new Set<string>();
  const unique = clubs.filter((c) => c.clubId !== "" && !seen.has(c.clubId) && !!seen.add(c.clubId));
  if (unique.length === 0) return { kind: "none" };
  if (unique.length === 1) return { kind: "one", club: unique[0] };
  // Most games first: an active club is more likely to be the one the visitor means.
  const sorted = [...unique].sort((a, b) => (b.gamesPlayed ?? -1) - (a.gamesPlayed ?? -1) || a.name.localeCompare(b.name) || a.clubId.localeCompare(b.clubId));
  return { kind: "many", clubs: sorted.slice(0, MAX_CHOICES), total: sorted.length };
}

/**
 * What a row in the choose list shows to identify a club. EA's name can be missing or blank, and a row must never
 * be unidentifiable, so the club ID is always present and a blank name says so instead of showing nothing.
 */
// Characters that draw nothing: control and format characters (zero-width space and joiners, bidi marks, BOM), the
// blank Braille pattern and the Hangul fillers. A club name made only of these is not empty, yet shows as blank.
const INVISIBLE = /[\p{C}\u2800\u3164\u115F\u1160\u180E\u2000-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/gu;

export function clubRowLabel(c: { name: string; clubId: string }): { name: string; nameMissing: boolean; idText: string } {
  const name = c.name.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  return { name: name !== "" ? name : `Club ${c.clubId}`, nameMissing: name === "", idText: `ID ${c.clubId}` };
}

/** The URL of a club's public profile. */
export function profilePath(clubId: string, platform: string): string {
  return `/club/${encodeURIComponent(clubId)}?platform=${encodeURIComponent(platform)}`;
}

/** The URL of the choose-a-club page for a search. */
export function selectPath(name: string, platform: string): string {
  return `/select?name=${encodeURIComponent(name)}&platform=${encodeURIComponent(platform)}`;
}

/** The home page with a message, so errors keep the visitor's search box instead of showing a blank error page. */
export function homePath(error: string, name?: string, platform?: string): string {
  const p = new URLSearchParams({ error });
  if (name) p.set("name", name);
  if (platform) p.set("platform", platform);
  return `/?${p}`;
}

