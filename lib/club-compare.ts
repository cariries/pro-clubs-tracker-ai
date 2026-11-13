// Club statistics, computed entirely in code. Takes 1 to 4 clubs (live EA data, shared 15-minute cache). ONE club shows that club's own
// statistics and every member; 2 to 4 clubs are put side by side: club-level metrics with rankings, recent form from the stored match scores, and member
// leaderboards across all the clubs. The language model never calculates anything; it only explains these
// numbers. Reads the stored jsonb defensively (older or newer parser versions may have left fields out) and
// never throws on odd shapes.
//
// Fairness rules, because a naive comparison misleads:
//  - a rate from a handful of games is noise (3 wins from 3 games is "100%"), so a club with fewer than
//    MIN_CLUB_GAMES league games, or a player with fewer than MIN_PLAYER_GAMES, shows its value but is NOT ranked;
//  - rankings use the values as displayed (already rounded), so two clubs that look equal are ranked equal
//    (standard competition ranking: 1, 1, 3);
//  - recent form is derived from the stored match SCORES, never from EA's result codes, which are unconfirmed;
//  - numbers from different platforms, or fetched far apart in time, are flagged, not silently mixed.
import type { PartKey, PartStatus } from "./club-capture";
import { dataAgeDays, formatUnix, isObj, num, partOf, str, PART_LABEL, type Bi } from "./data-utils";
import { readRecentMatches, type RecentMatches } from "./recent-matches";

/** A single club is allowed: it shows that club's own statistics and members. */
export const MIN_CLUBS = 1;
/** Comparing clubs with each other needs at least this many. */
export const MIN_TO_COMPARE = 2;
export const MAX_CLUBS = 4;
/** Members listed per club on the screen and in the AI digest. */
export const MEMBERS_SINGLE = 30;
export const MEMBERS_PER_CLUB = 12;
export const MIN_CLUB_GAMES = 10;
export const MIN_RECENT_MATCHES = 5;
export const MIN_PLAYER_GAMES = 5;
export const STALE_DAYS = 14;
export const SAVED_APART_DAYS = 7;
export const RECENT_FORM_MATCHES = 10;
export const BOARD_SIZE = 10;

/** One club's captured data (from the shared cache or a live EA fetch). */
export interface ClubInput {
  id: string;
  label: string;
  /** ISO time the data was fetched; used if the payload has no `capturedAt`. */
  createdAt: string;
  clubId: string;
  platform: string;
  data: unknown;
}

export interface ClubRecord {
  games: number | null;
  wins: number | null;
  ties: number | null;
  losses: number | null;
  goals: number | null;
  goalsAgainst: number | null;
}

export interface RecentForm {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Newest first. */
  results: Array<"W" | "D" | "L">;
}

/** One member of a club: season statistics plus career totals (joined by name). */
export interface MemberRow {
  name: string;
  pos: string | null;
  games: number | null;
  goals: number | null;
  assists: number | null;
  goalsPerGame: number | null;
  assistsPerGame: number | null;
  rating: number | null;
  motm: number | null;
  /** EA's own season percentages (0-100). */
  passPct: number | null;
  shotPct: number | null;
  tacklePct: number | null;
  redCards: number | null;
  careerGames: number | null;
  careerGoals: number | null;
  careerAssists: number | null;
  careerRating: number | null;
  /** True when the member has enough games to be ranked on rates. Others are listed but not ranked. */
  ranked: boolean;
}

export interface SquadSummary {
  players: number;
  topScorer: { name: string; goals: number } | null;
  topAssister: { name: string; assists: number } | null;
  /** Best season rating among players with at least MIN_PLAYER_GAMES games. */
  bestRated: { name: string; rating: number; games: number } | null;
}

export interface ClubProfile {
  /** The club id (club:platform). All cross references in this module use it. */
  id: string;
  label: string;
  clubId: string;
  platform: string;
  /** Club name from EA, or null if it could not be read. */
  name: string | null;
  capturedAt: string;
  newestMatchAt: string | null;
  dataAgeDays: number | null;
  record: ClubRecord | null;
  skillRating: number | null;
  winStreak: number | null;
  unbeatenStreak: number | null;
  recentForm: RecentForm | null;
  /** The newest league matches (up to 10) with per-member numbers, oldest first. Null when matches were not loaded. */
  recent: RecentMatches | null;
  squad: SquadSummary | null;
  /** Every member, most games first. Cut for display and for the AI digest, never here. */
  members: MemberRow[];
  /** Status of every part in the captured data (null = not present). */
  parts: Record<PartKey, PartStatus | null>;
}

export type MetricKey = "skillRating" | "winRate" | "goalsForPerGame" | "goalsAgainstPerGame" | "goalDiffPerGame" | "recentWinRate";
export type MetricNote = "ok" | "no_data" | "too_few_games" | "too_few_matches" | "no_peers";

export interface MetricEntry {
  /** Club id (club:platform). */
  id: string;
  value: number | null;
  /** Competition rank among eligible clubs (1 = best), or null if not ranked. */
  rank: number | null;
  note: MetricNote;
}

export interface MetricComparison {
  key: MetricKey;
  /** Which direction is better. */
  direction: "higher" | "lower";
  unit: "percent" | "goals per game" | "rating points";
  entries: MetricEntry[];
  /** Ids holding rank 1 (several on a tie). Empty when fewer than two clubs could be ranked. */
  leaders: string[];
  /** Best minus worst ranked value, null if fewer than two clubs were ranked. */
  gap: number | null;
}

export type PlayerBoardKey =
  | "goalsPerGame"
  | "assistsPerGame"
  | "goalContributionsPerGame"
  | "rating"
  | "motmPerGame"
  | "passSuccessRate"
  | "shotSuccessRate"
  | "tackleSuccessRate";

/**
 * Names for the screen, in both languages. Crossing and dribbling are NOT here on purpose: the captured data has
 * no field for them (only pass, shot and tackle success rates), so they cannot be compared.
 */
export const METRIC_LABEL: Record<MetricKey, Bi & { unitZh: string }> = {
  skillRating: { en: "Skill rating", zh: "技術評分", unitZh: "分" },
  winRate: { en: "Win rate", zh: "勝率", unitZh: "%" },
  goalsForPerGame: { en: "Goals scored per game", zh: "場均入球", unitZh: "球" },
  goalsAgainstPerGame: { en: "Goals conceded per game (lower is better)", zh: "場均失球(越低越好)", unitZh: "球" },
  goalDiffPerGame: { en: "Goal difference per game", zh: "場均淨勝球", unitZh: "球" },
  recentWinRate: { en: "Win rate in recent matches", zh: "近期賽事勝率", unitZh: "%" },
};

export const BOARD_LABEL: Record<PlayerBoardKey, Bi> = {
  goalsPerGame: { en: "Goals per game", zh: "場均入球" },
  assistsPerGame: { en: "Assists per game", zh: "場均助攻" },
  goalContributionsPerGame: { en: "Goals + assists per game", zh: "場均入球加助攻" },
  rating: { en: "Average match rating", zh: "平均評分" },
  motmPerGame: { en: "Man of the match per game", zh: "場均最佳球員" },
  passSuccessRate: { en: "Pass success rate (%)", zh: "傳球成功率(%)" },
  shotSuccessRate: { en: "Shot success rate (%)", zh: "射門成功率(%)" },
  tackleSuccessRate: { en: "Tackle success rate (%)", zh: "搶截成功率(%)" },
};

export interface PlayerBoardEntry {
  rank: number;
  /** Id of the player's club. */
  clubId: string;
  clubName: string;
  name: string;
  pos: string | null;
  games: number;
  value: number;
  goals: number | null;
  assists: number | null;
  rating: number | null;
}

export interface PlayerBoard {
  key: PlayerBoardKey;
  minGames: number;
  /** Players with enough games to be ranked / players found in total. */
  eligible: number;
  total: number;
  /** Best first, at most BOARD_SIZE. */
  entries: PlayerBoardEntry[];
}

export type WarningCode =
  | "not_enough_clubs"
  | "duplicate_club"
  | "mixed_platforms"
  | "thin_games"
  | "stale_data"
  | "saved_far_apart"
  | "part_missing"
  | "record_mismatch";

export interface ComparisonWarning {
  code: WarningCode;
  /** Display name of the club the warning is about. */
  club?: string;
  part?: PartKey;
  count?: number;
  days?: number;
  platforms?: string[];
}

export interface ClubComparison {
  /** "single" = one club on its own; "compare" = 2 to 4 clubs side by side. */
  mode: "single" | "compare";
  clubs: ClubProfile[];
  metrics: MetricComparison[];
  playerBoards: PlayerBoard[];
  samePlatform: boolean;
  /** Clubs that have a readable record and so take part in the numbers. */
  usableClubs: number;
  warnings: ComparisonWarning[];
}

// ------------------------------------------------------------------------------------------------ helpers

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function ratio(a: number | null, b: number | null, scale: number, round: (n: number) => number): number | null {
  return a === null || b === null || b <= 0 ? null : round((a / b) * scale);
}

/**
 * Standard competition ranking over already-rounded values. Entries that are not eligible, or have no value,
 * get null. 1 = best.
 */
export function competitionRanks(items: Array<{ value: number | null; eligible: boolean }>, direction: "higher" | "lower"): Array<number | null> {
  const ranked = items.map((it, i) => ({ i, v: it.eligible ? it.value : null })).filter((x): x is { i: number; v: number } => x.v !== null);
  const out: Array<number | null> = items.map(() => null);
  for (const x of ranked) {
    const better = ranked.filter((y) => (direction === "higher" ? y.v > x.v : y.v < x.v)).length;
    out[x.i] = better + 1;
  }
  return out;
}

const displayName = (p: ClubProfile) => p.name ?? p.label;

// ------------------------------------------------------------------------------------------------ one club

interface PlayerRec {
  name: string;
  pos: string | null;
  games: number | null;
  goals: number | null;
  assists: number | null;
  rating: number | null;
  motm: number | null;
  /** EA's own season percentages (0-100). Passes/shots/tackles totals are not weighed in. */
  passPct: number | null;
  shotPct: number | null;
  tacklePct: number | null;
  redCards: number | null;
}

interface CareerRec {
  games: number | null;
  goals: number | null;
  assists: number | null;
  rating: number | null;
}

function readRecord(data: unknown): ClubRecord | null {
  const ov = partOf(isObj(data) ? data.parts : undefined, "overallStats").data;
  const first = Array.isArray(ov) && isObj(ov[0]) ? (ov[0] as Record<string, unknown>) : null;
  if (!first) return null;
  return {
    games: num(first.gamesPlayed),
    wins: num(first.wins),
    ties: num(first.ties),
    losses: num(first.losses),
    goals: num(first.goals),
    goalsAgainst: num(first.goalsAgainst),
  };
}

function readOverallExtras(data: unknown): { skillRating: number | null; winStreak: number | null; unbeatenStreak: number | null } {
  const ov = partOf(isObj(data) ? data.parts : undefined, "overallStats").data;
  const first = Array.isArray(ov) && isObj(ov[0]) ? (ov[0] as Record<string, unknown>) : null;
  return {
    skillRating: first ? num(first.skillRating) : null,
    winStreak: first ? num(first.winStreak) : null,
    unbeatenStreak: first ? num(first.unbeatenStreak) : null,
  };
}

function readName(data: unknown): string | null {
  const info = partOf(isObj(data) ? data.parts : undefined, "clubInfo").data;
  return Array.isArray(info) && isObj(info[0]) ? str(info[0].name) : null;
}

function readPlayers(data: unknown): PlayerRec[] {
  const d = partOf(isObj(data) ? data.parts : undefined, "memberStats").data;
  if (!isObj(d) || !Array.isArray(d.members)) return [];
  const out: PlayerRec[] = [];
  for (const m of d.members) {
    if (!isObj(m)) continue;
    const name = str(m.name);
    if (!name) continue;
    out.push({
      name,
      pos: str(m.favoritePosition),
      games: num(m.gamesPlayed),
      goals: num(m.goals),
      assists: num(m.assists),
      rating: num(m.ratingAve),
      motm: num(m.manOfTheMatch),
      passPct: num(m.passSuccessRate),
      shotPct: num(m.shotSuccessRate),
      tacklePct: num(m.tackleSuccessRate),
      redCards: num(m.redCards),
    });
  }
  return out;
}

function readCareer(data: unknown): Map<string, CareerRec> {
  const out = new Map<string, CareerRec>();
  const d = partOf(isObj(data) ? data.parts : undefined, "memberCareerStats").data;
  if (!isObj(d) || !Array.isArray(d.members)) return out;
  for (const m of d.members) {
    if (!isObj(m)) continue;
    const name = str(m.name);
    if (name) out.set(name, { games: num(m.gamesPlayed), goals: num(m.goals), assists: num(m.assists), rating: num(m.ratingAve) });
  }
  return out;
}

function memberRows(players: PlayerRec[], career: Map<string, CareerRec>): MemberRow[] {
  return players
    .map((p): MemberRow => {
      const c = career.get(p.name);
      return {
        name: p.name,
        pos: p.pos,
        games: p.games,
        goals: p.goals,
        assists: p.assists,
        goalsPerGame: ratio(p.goals, p.games, 1, r2),
        assistsPerGame: ratio(p.assists, p.games, 1, r2),
        rating: p.rating === null ? null : r2(p.rating),
        motm: p.motm,
        passPct: p.passPct,
        shotPct: p.shotPct,
        tacklePct: p.tacklePct,
        redCards: p.redCards,
        careerGames: c?.games ?? null,
        careerGoals: c?.goals ?? null,
        careerAssists: c?.assists ?? null,
        careerRating: c?.rating ?? null,
        ranked: p.games !== null && p.games >= MIN_PLAYER_GAMES,
      };
    })
    .sort((a, b) => (b.games ?? -1) - (a.games ?? -1) || a.name.localeCompare(b.name));
}

function readRecentForm(data: unknown, clubId: string): RecentForm | null {
  const arr = partOf(isObj(data) ? data.parts : undefined, "leagueMatches").data;
  if (!Array.isArray(arr)) return null;
  const rows: Array<{ ts: number | null; gf: number; ga: number }> = [];
  for (const m of arr) {
    if (!isObj(m)) continue;
    const clubs = isObj(m.clubs) ? m.clubs : {};
    const ours = isObj(clubs[clubId]) ? (clubs[clubId] as Record<string, unknown>) : null;
    const gf = ours ? num(ours.goals) : null;
    const ga = ours ? num(ours.goalsAgainst) : null;
    if (gf === null || ga === null) continue; // can't tell the result without both scores
    rows.push({ ts: num(m.timestamp), gf, ga });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => (b.ts ?? -Infinity) - (a.ts ?? -Infinity));
  const take = rows.slice(0, RECENT_FORM_MATCHES);
  const results = take.map((r): "W" | "D" | "L" => (r.gf > r.ga ? "W" : r.gf < r.ga ? "L" : "D"));
  return {
    played: take.length,
    wins: results.filter((r) => r === "W").length,
    draws: results.filter((r) => r === "D").length,
    losses: results.filter((r) => r === "L").length,
    goalsFor: take.reduce((a, r) => a + r.gf, 0),
    goalsAgainst: take.reduce((a, r) => a + r.ga, 0),
    results,
  };
}

function squadOf(players: PlayerRec[]): SquadSummary | null {
  if (players.length === 0) return null;
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  const scorers = players.filter((p) => p.goals !== null).sort((a, b) => (b.goals! - a.goals!) || byName(a, b));
  const assisters = players.filter((p) => p.assists !== null).sort((a, b) => (b.assists! - a.assists!) || byName(a, b));
  const rated = players
    .filter((p) => p.rating !== null && p.games !== null && p.games >= MIN_PLAYER_GAMES)
    .sort((a, b) => (b.rating! - a.rating!) || byName(a, b));
  return {
    players: players.length,
    topScorer: scorers[0] ? { name: scorers[0].name, goals: scorers[0].goals! } : null,
    topAssister: assisters[0] ? { name: assisters[0].name, assists: assisters[0].assists! } : null,
    bestRated: rated[0] ? { name: rated[0].name, rating: rated[0].rating!, games: rated[0].games! } : null,
  };
}

function profileOf(inp: ClubInput): { profile: ClubProfile; players: PlayerRec[] } {
  const root = isObj(inp.data) ? inp.data : {};
  const capturedAt = str(root.capturedAt) ?? inp.createdAt;
  const newestTs = num(root.newestMatchTimestamp);
  const players = readPlayers(inp.data);
  const parts = {} as Record<PartKey, PartStatus | null>;
  for (const key of Object.keys(PART_LABEL) as PartKey[]) parts[key] = partOf(isObj(inp.data) ? inp.data.parts : undefined, key).status;
  return {
    players,
    profile: {
      id: inp.id,
      label: inp.label,
      clubId: inp.clubId,
      platform: inp.platform,
      name: readName(inp.data),
      capturedAt,
      newestMatchAt: formatUnix(newestTs),
      dataAgeDays: dataAgeDays(capturedAt, newestTs),
      record: readRecord(inp.data),
      ...readOverallExtras(inp.data),
      recentForm: readRecentForm(inp.data, inp.clubId),
      recent: readRecentMatches(inp.data, inp.clubId),
      squad: squadOf(players),
      members: memberRows(players, readCareer(inp.data)),
      parts,
    },
  };
}

// ------------------------------------------------------------------------------------------------ metrics

interface MetricDef {
  key: MetricKey;
  direction: "higher" | "lower";
  unit: MetricComparison["unit"];
  value(p: ClubProfile): number | null;
  /** Whether the club has enough games or matches for this metric to be ranked, and the note if not. */
  enough(p: ClubProfile): { ok: boolean; note: MetricNote };
}

const leagueGames = (p: ClubProfile) => p.record?.games ?? null;
const enoughGames = (p: ClubProfile) => {
  const g = leagueGames(p);
  if (g === null) return { ok: false, note: "no_data" as const };
  return g >= MIN_CLUB_GAMES ? { ok: true, note: "ok" as const } : { ok: false, note: "too_few_games" as const };
};

const METRICS: MetricDef[] = [
  { key: "skillRating", direction: "higher", unit: "rating points", value: (p) => p.skillRating, enough: enoughGames },
  { key: "winRate", direction: "higher", unit: "percent", value: (p) => ratio(p.record?.wins ?? null, leagueGames(p), 100, r1), enough: enoughGames },
  { key: "goalsForPerGame", direction: "higher", unit: "goals per game", value: (p) => ratio(p.record?.goals ?? null, leagueGames(p), 1, r2), enough: enoughGames },
  { key: "goalsAgainstPerGame", direction: "lower", unit: "goals per game", value: (p) => ratio(p.record?.goalsAgainst ?? null, leagueGames(p), 1, r2), enough: enoughGames },
  {
    key: "goalDiffPerGame",
    direction: "higher",
    unit: "goals per game",
    value: (p) => {
      const r = p.record;
      return r && r.goals !== null && r.goalsAgainst !== null ? ratio(r.goals - r.goalsAgainst, r.games, 1, r2) : null;
    },
    enough: enoughGames,
  },
  {
    key: "recentWinRate",
    direction: "higher",
    unit: "percent",
    value: (p) => (p.recentForm ? ratio(p.recentForm.wins, p.recentForm.played, 100, r1) : null),
    enough: (p) =>
      !p.recentForm ? { ok: false, note: "no_data" } : p.recentForm.played >= MIN_RECENT_MATCHES ? { ok: true, note: "ok" } : { ok: false, note: "too_few_matches" },
  },
];

function compareMetric(def: MetricDef, clubs: ClubProfile[]): MetricComparison {
  const cells = clubs.map((p) => {
    const value = def.value(p);
    const e = def.enough(p);
    return { id: p.id, value, eligible: e.ok && value !== null, note: value === null && e.ok ? ("no_data" as const) : e.note };
  });
  let ranks = competitionRanks(cells, def.direction);
  const rankedCount = ranks.filter((r) => r !== null).length;
  // One club ranked alone is not "first" at anything.
  if (rankedCount < 2) ranks = ranks.map(() => null);
  const entries: MetricEntry[] = cells.map((c, i) => ({
    id: c.id,
    value: c.value,
    rank: ranks[i],
    note: c.eligible && rankedCount < 2 ? "no_peers" : c.note,
  }));
  const ranked = entries.filter((e) => e.rank !== null && e.value !== null);
  const values = ranked.map((e) => e.value as number);
  return {
    key: def.key,
    direction: def.direction,
    unit: def.unit,
    entries,
    leaders: ranked.filter((e) => e.rank === 1).map((e) => e.id),
    gap: ranked.length >= 2 ? r2(Math.max(...values) - Math.min(...values)) : null,
  };
}

// ------------------------------------------------------------------------------------------------ players

interface BoardDef {
  key: PlayerBoardKey;
  value(p: PlayerRec): number | null;
}

const BOARDS: BoardDef[] = [
  { key: "goalsPerGame", value: (p) => ratio(p.goals, p.games, 1, r2) },
  { key: "assistsPerGame", value: (p) => ratio(p.assists, p.games, 1, r2) },
  { key: "goalContributionsPerGame", value: (p) => (p.goals !== null && p.assists !== null ? ratio(p.goals + p.assists, p.games, 1, r2) : null) },
  { key: "rating", value: (p) => (p.rating === null ? null : r2(p.rating)) },
  { key: "motmPerGame", value: (p) => ratio(p.motm, p.games, 1, r2) },
  { key: "passSuccessRate", value: (p) => p.passPct },
  { key: "shotSuccessRate", value: (p) => p.shotPct },
  { key: "tackleSuccessRate", value: (p) => p.tacklePct },
];

function buildBoards(clubs: ClubProfile[], playersByClub: Map<string, PlayerRec[]>): PlayerBoard[] {
  const all = clubs.flatMap((c) => (playersByClub.get(c.id) ?? []).map((p) => ({ club: c, p })));
  return BOARDS.map((def) => {
    const rows = all.map(({ club, p }) => ({ club, p, value: def.value(p), eligible: p.games !== null && p.games >= MIN_PLAYER_GAMES }));
    const ranks = competitionRanks(rows, "higher");
    const entries = rows
      .map((r, i) => ({ r, rank: ranks[i] }))
      .filter((x): x is { r: (typeof rows)[number]; rank: number } => x.rank !== null)
      // Best value first; ties by more games, then name, then club, so the order never depends on input order.
      .sort((a, b) => (b.r.value! - a.r.value!) || (b.r.p.games! - a.r.p.games!) || a.r.p.name.localeCompare(b.r.p.name) || a.r.club.id.localeCompare(b.r.club.id))
      .slice(0, BOARD_SIZE)
      .map(({ r, rank }): PlayerBoardEntry => ({
        rank,
        clubId: r.club.id,
        clubName: displayName(r.club),
        name: r.p.name,
        pos: r.p.pos,
        games: r.p.games!,
        value: r.value!,
        goals: r.p.goals,
        assists: r.p.assists,
        rating: r.p.rating,
      }));
    return { key: def.key, minGames: MIN_PLAYER_GAMES, eligible: ranks.filter((r) => r !== null).length, total: rows.length, entries };
  });
}

// ------------------------------------------------------------------------------------------------ main

export function compareClubs(input: ClubInput[]): ClubComparison {
  const warnings: ComparisonWarning[] = [];

  // The same club chosen twice would be compared with itself. Keep the newest data.
  const built = input.map((inp) => ({ inp, ...profileOf(inp) }));
  const newestFirst = [...built].sort((a, b) => b.profile.capturedAt.localeCompare(a.profile.capturedAt) || a.inp.id.localeCompare(b.inp.id));
  const keep = new Set<string>();
  const seen = new Map<string, number>();
  for (const b of newestFirst) {
    const key = `${b.profile.clubId}:${b.profile.platform}`;
    if (seen.has(key)) {
      seen.set(key, seen.get(key)! + 1);
    } else {
      seen.set(key, 0);
      keep.add(b.inp.id);
    }
  }
  const kept = built.filter((b) => keep.has(b.inp.id));
  for (const b of kept) {
    const extra = seen.get(`${b.profile.clubId}:${b.profile.platform}`) ?? 0;
    if (extra > 0) warnings.push({ code: "duplicate_club", club: displayName(b.profile), count: extra });
  }

  const clubs = kept.map((b) => b.profile);
  const playersByClub = new Map(kept.map((b) => [b.profile.id, b.players]));
  const usable = clubs.filter((c) => c.record !== null);

  // One club on its own is fine. The warning is for a comparison that lost its peers, or no readable club at all.
  if (usable.length === 0 || (clubs.length >= MIN_TO_COMPARE && usable.length < MIN_TO_COMPARE)) warnings.push({ code: "not_enough_clubs", count: usable.length });

  const platforms = [...new Set(clubs.map((c) => c.platform))];
  const samePlatform = platforms.length <= 1;
  if (!samePlatform) warnings.push({ code: "mixed_platforms", platforms });

  for (const c of clubs) {
    for (const part of ["overallStats", "memberStats"] as const) {
      if (c.parts[part] !== "ok") warnings.push({ code: "part_missing", club: displayName(c), part });
    }
    const r = c.record;
    if (r && r.games !== null && r.games < MIN_CLUB_GAMES) warnings.push({ code: "thin_games", club: displayName(c), count: r.games });
    if (r && r.games !== null && r.wins !== null && r.ties !== null && r.losses !== null && r.wins + r.ties + r.losses !== r.games) {
      warnings.push({ code: "record_mismatch", club: displayName(c) });
    }
    if (c.dataAgeDays !== null && c.dataAgeDays > STALE_DAYS) warnings.push({ code: "stale_data", club: displayName(c), days: c.dataAgeDays });
  }

  const times = clubs.map((c) => Date.parse(c.capturedAt)).filter((t) => !Number.isNaN(t));
  if (times.length >= 2) {
    const apart = Math.floor((Math.max(...times) - Math.min(...times)) / 86_400_000);
    if (apart > SAVED_APART_DAYS) warnings.push({ code: "saved_far_apart", days: apart });
  }

  return {
    mode: clubs.length === 1 ? "single" : "compare",
    clubs,
    metrics: METRICS.map((def) => compareMetric(def, clubs)),
    playerBoards: buildBoards(clubs, playersByClub),
    samePlatform,
    usableClubs: usable.length,
    warnings,
  };
}

// ------------------------------------------------------------------------------------------------ wording

/** A warning in English and Traditional Cantonese. The page shows both; the model is given the English. */
export function describeWarning(w: ComparisonWarning): Bi {
  const club = w.club ?? "?";
  const n = w.count ?? 0;
  const d = w.days ?? 0;
  const part = w.part ? PART_LABEL[w.part] : { en: "data", zh: "資料" };
  switch (w.code) {
    case "not_enough_clubs":
      return n === 0
        ? { en: "None of the selected clubs has usable stats from EA.", zh: "所揀嘅球會入面,EA 冇一個提供到可用數據。" }
        : { en: `Only ${n} of the selected clubs has usable stats, so there is nothing to compare.`, zh: `所揀嘅球會入面只有 ${n} 個有可用數據,所以冇嘢可以比較。` };
    case "duplicate_club":
      return { en: `"${club}" was selected more than once (${n} extra ${n === 1 ? "copy" : "copies"} ignored); the newest data is used.`, zh: `「${club}」被重複揀選(已忽略 ${n} 個多餘副本),只用最新嘅資料。` };
    case "mixed_platforms":
      return { en: `The clubs are on different platforms (${(w.platforms ?? []).join(", ")}). Their ratings and records come from separate player pools and are not directly comparable.`, zh: `呢啲球會喺唔同平台(${(w.platforms ?? []).join("、")}),佢哋嘅評分同戰績來自獨立嘅玩家群,不能直接比較。` };
    case "thin_games":
      return { en: `"${club}" has only ${n} league games, so its rates are shown but not ranked (a minimum of ${MIN_CLUB_GAMES} is needed; fewer is mostly noise).`, zh: `「${club}」只有 ${n} 場聯賽,所以只顯示數值而唔排名(最少需要 ${MIN_CLUB_GAMES} 場;場數太少多數只係偶然)。` };
    case "stale_data":
      return { en: `"${club}": EA's newest match was ${d} days old when the data was fetched, so the numbers may not show current form.`, zh: `「${club}」:擷取資料時,EA 最新一場賽事已經係 ${d} 日前,數字可能唔反映近況。` };
    case "saved_far_apart":
      return { en: `The club data was fetched ${d} days apart, so the clubs are compared at different moments.`, zh: `呢幾個球會嘅資料相隔 ${d} 日擷取,所以係喺唔同時間點比較各球會。` };
    case "part_missing":
      return { en: `"${club}": ${part.en} could not be read from EA (failed, empty or missing).`, zh: `「${club}」:讀取唔到 EA 嘅${part.zh}(失敗、冇資料或欠缺)。` };
    case "record_mismatch":
      return { en: `"${club}": wins + draws + losses do not add up to games played, so its record may be unreliable.`, zh: `「${club}」:勝、和、負加起來同總場數對唔上,戰績可能唔可靠。` };
  }
}

export const WARNING_CODES: WarningCode[] = ["not_enough_clubs", "duplicate_club", "mixed_platforms", "thin_games", "stale_data", "saved_far_apart", "part_missing", "record_mismatch"];
