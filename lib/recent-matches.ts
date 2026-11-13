// Recent league matches (up to RECENT_MATCHES) read from a captured club, for the club and member charts and for the AI.
// The input is the STORED capture, which holds EA's data AFTER our parser (lib/ea-types.ts parseMatches): clubs[id].name,
// goals, goalsAgainst, and players[clubId] as a LIST of { name, goals, assists, rating, passAttempts, passesMade, ... }.
// It is NOT EA's raw shape (playername, passattempts), so do not read raw field names here. Pure and defensive: stored data may come from an older parser or be partly missing, so every field is checked and a
// match that cannot be read is skipped, never guessed. Member trends are matched by GAMER TAG (EA gives no stable id
// across the season stats and the match lists), so a renamed member splits into two series.
import { isObj, num, partOf, str } from "./data-utils";

/** How many of the newest league matches are used (EA allows up to 10 per request). */
export const RECENT_MATCHES = 10;
/** A member needs at least this many appearances in the window for a trend line to mean anything. */
export const MIN_TREND_APPEARANCES = 3;
/** Most members drawn in the per-match charts and sent to the AI (busiest first). */
export const TREND_MEMBERS_MAX = 6;

export type Outcome = "W" | "D" | "L";

export interface ClubMatch {
  matchId: string;
  /** Unix seconds, or null if EA gave none. */
  timestamp: number | null;
  goalsFor: number;
  goalsAgainst: number;
  outcome: Outcome;
  /** The opponent's name when EA lists it; the id otherwise; null if neither. */
  opponent: string | null;
}

export interface MemberMatch {
  /** 1 = the OLDEST match in the window. Position in the sequence, so a gap (not playing) is visible. */
  matchNo: number;
  goals: number | null;
  assists: number | null;
  /** The member's rating in that match (EA's 0-10 scale). */
  rating: number | null;
  /** Percent of passes completed in that match, or null with no pass attempts. */
  passPct: number | null;
}

export interface MemberTrend {
  name: string;
  appearances: number;
  /** One entry per appearance, oldest first. */
  matches: MemberMatch[];
  totalGoals: number;
  totalAssists: number;
  /** Average rating over the appearances that have one, one decimal; null with none. */
  avgRating: number | null;
}

export interface RecentMatches {
  /** The club's matches, OLDEST first (so charts read left to right through time). */
  matches: ClubMatch[];
  members: MemberTrend[];
  /** How many matches in the stored data could not be read (missing scores). */
  skipped: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function outcomeOf(gf: number, ga: number): Outcome {
  return gf > ga ? "W" : gf < ga ? "L" : "D";
}

/** Reads the stored `leagueMatches` part of a capture. Returns null when the part is absent or has no readable match. */
export function readRecentMatches(data: unknown, clubId: string): RecentMatches | null {
  const arr = partOf(isObj(data) ? data.parts : undefined, "leagueMatches").data;
  if (!Array.isArray(arr)) return null;

  interface Raw {
    ts: number | null;
    order: number;
    club: ClubMatch;
    players: unknown;
  }
  const rows: Raw[] = [];
  let skipped = 0;
  arr.forEach((m, order) => {
    if (!isObj(m)) {
      skipped++;
      return;
    }
    const clubs = isObj(m.clubs) ? m.clubs : {};
    const ours = isObj(clubs[clubId]) ? (clubs[clubId] as Record<string, unknown>) : null;
    const gf = ours ? num(ours.goals) : null;
    const ga = ours ? num(ours.goalsAgainst) : null;
    if (gf === null || ga === null) {
      skipped++;
      return; // the result cannot be told without both scores
    }
    // the opponent is the other club listed (name from its details), else the other key under players
    let opponent: string | null = null;
    for (const [id, c] of Object.entries(clubs)) {
      if (id === clubId || !isObj(c)) continue;
      opponent = str((c as Record<string, unknown>).name) ?? id;
      break;
    }
    if (opponent === null && isObj(m.players)) opponent = Object.keys(m.players as Record<string, unknown>).find((id) => id !== clubId) ?? null;
    rows.push({
      ts: num(m.timestamp),
      order,
      club: { matchId: str(m.matchId) ?? String(order), timestamp: num(m.timestamp), goalsFor: gf, goalsAgainst: ga, outcome: outcomeOf(gf, ga), opponent },
      players: m.players,
    });
  });
  if (rows.length === 0) return null;

  // Newest first by time, falling back to the order EA sent (newest first); then keep the newest RECENT_MATCHES and reverse.
  rows.sort((a, b) => (b.ts ?? -Infinity) - (a.ts ?? -Infinity) || a.order - b.order);
  const window = rows.slice(0, RECENT_MATCHES).reverse(); // oldest first

  const byName = new Map<string, MemberMatch[]>();
  window.forEach((row, i) => {
    const matchNo = i + 1;
    const mine = isObj(row.players) ? (row.players as Record<string, unknown>)[clubId] : null;
    if (!Array.isArray(mine)) return;
    for (const p of mine) {
      if (!isObj(p)) continue;
      const name = str(p.name);
      if (!name) continue;
      const attempts = num(p.passAttempts);
      const made = num(p.passesMade);
      const list = byName.get(name) ?? [];
      list.push({
        matchNo,
        goals: num(p.goals),
        assists: num(p.assists),
        rating: num(p.rating),
        passPct: attempts !== null && attempts > 0 && made !== null ? r1((made / attempts) * 100) : null,
      });
      byName.set(name, list);
    }
  });

  const members: MemberTrend[] = [...byName.entries()].map(([name, matches]) => {
    const ratings = matches.map((m) => m.rating).filter((v): v is number => v !== null);
    return {
      name,
      appearances: matches.length,
      matches,
      totalGoals: matches.reduce((a, m) => a + (m.goals ?? 0), 0),
      totalAssists: matches.reduce((a, m) => a + (m.assists ?? 0), 0),
      avgRating: ratings.length === 0 ? null : r1(ratings.reduce((a, b) => a + b, 0) / ratings.length),
    };
  });
  // busiest first, then by name so the order is stable
  members.sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name));

  return { matches: window.map((w) => w.club), members, skipped };
}

/** The form string, oldest to newest, e.g. "WWDLW". */
export const formString = (r: RecentMatches): string => r.matches.map((m) => m.outcome).join("");

/** The members worth a trend line: enough appearances, busiest first, capped. */
export function trendMembers(r: RecentMatches): MemberTrend[] {
  return r.members.filter((m) => m.appearances >= MIN_TREND_APPEARANCES).slice(0, TREND_MEMBERS_MAX);
}
