// Shapes a captured club (the same data Ask AI uses) into what the public profile page shows. Reuses the
// club comparison engine, so the public page and Ask AI agree on every number. Pure and defensive.
import { compareClubs, type ClubProfile, type MemberRow } from "./club-compare";
import { dataAgeDays, isObj, num, partOf, str } from "./data-utils";
import type { CaptureResult } from "./club-capture";

export interface PublicClub {
  profile: ClubProfile;
  members: MemberRow[];
  /** Average of the club's goals for / against per league game, from the overall record. */
  goalsForPerGame: number | null;
  goalsAgainstPerGame: number | null;
  winRate: number | null;
  /** Division from the club info, if EA gave one. */
  newestMatchAt: string | null;
  dataAgeDays: number | null;
  /** Parts that failed (so the page can say the data is partial). */
  failedParts: string[];
  /** The club's stadium, from the club info. */
  stadium: string | null;
  /** True when the club has fewer than the games needed to read its rates reliably. */
  thin: boolean;
}

export const MIN_RELIABLE_GAMES = 10;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Builds the public view from a capture. Never throws on odd shapes. */
export function buildPublicClub(cap: CaptureResult, clubId: string, platform: string): PublicClub {
  const data = JSON.parse(JSON.stringify(cap.payload)) as unknown;
  const cmp = compareClubs([{ id: clubId, label: `Club ${clubId}`, createdAt: cap.payload.capturedAt, clubId, platform, data }]);
  const profile = cmp.clubs[0];
  const rec = profile.record;
  const games = rec?.games ?? null;
  const info = partOf(isObj(data) ? data.parts : undefined, "clubInfo").data;
  const infoFirst = Array.isArray(info) && isObj(info[0]) ? info[0] : null;
  const newestTs = isObj(data) ? num(data.newestMatchTimestamp) : null;
  return {
    profile,
    members: profile.members,
    goalsForPerGame: rec && rec.goals !== null && games ? r2(rec.goals / games) : null,
    goalsAgainstPerGame: rec && rec.goalsAgainst !== null && games ? r2(rec.goalsAgainst / games) : null,
    winRate: rec && rec.wins !== null && games ? r1((rec.wins / games) * 100) : null,
    newestMatchAt: profile.newestMatchAt,
    dataAgeDays: newestTs === null ? null : dataAgeDays(cap.payload.capturedAt, newestTs),
    failedParts: Object.entries(cap.summary.statuses)
      .filter(([, s]) => s === "failed")
      .map(([k]) => k),
    stadium: infoFirst ? str(infoFirst.stadiumName) : null,
    thin: games !== null && games < MIN_RELIABLE_GAMES,
  };
}
