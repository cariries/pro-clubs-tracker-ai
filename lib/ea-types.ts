// Types and parsing for EA's `members/stats` response (public name: memberStats).
// Shape taken from a real sample the user pasted on 2026-11-11 (fixtures/memberStats.sample.json).
// EA sends every number as a string; parse at the edge so the rest of the app sees numbers.
// Only memberStats is typed so far. Other endpoints still return raw JSON until samples exist.

/** Raw shape from EA. All stat values are strings. */
export interface MemberStatsRaw {
  members: Array<Record<string, string> & { name: string }>;
  positionCount?: Partial<Record<Position, number>>;
}

export type Position = "goalkeeper" | "defender" | "midfielder" | "forward";

export interface MemberStats {
  name: string;
  gamesPlayed: number | null;
  winRate: number | null;
  goals: number | null;
  assists: number | null;
  cleanSheetsDef: number | null;
  cleanSheetsGK: number | null;
  shotSuccessRate: number | null;
  passesMade: number | null;
  passSuccessRate: number | null;
  /** Average match rating, e.g. 9.4 */
  ratingAve: number | null;
  tacklesMade: number | null;
  tackleSuccessRate: number | null;
  manOfTheMatch: number | null;
  redCards: number | null;
  /** Pro (in-game player) card info. proPos, proStyle and proNationality are EA numeric codes, not names. */
  proName: string | null;
  proPos: number | null;
  proStyle: number | null;
  proHeight: number | null;
  proNationality: number | null;
  proOverall: number | null;
  favoritePosition: string | null;
  /**
   * EA's prevGoals and prevGoals1..prevGoals10 fields. Meaning is not documented (possibly goals per
   * recent match). Kept as a plain list, in field order, until their meaning is confirmed.
   */
  prevGoals: Array<number | null>;
}

export interface MemberStatsResult {
  members: MemberStats[];
  positionCount: Partial<Record<Position, number>>;
}

/** Numeric string to number. Missing or non-numeric gives null, never a silent 0. */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toStr(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

const PREV_GOAL_KEYS = ["prevGoals", ...Array.from({ length: 10 }, (_, i) => `prevGoals${i + 1}`)];

export function parseMemberStats(raw: unknown): MemberStatsResult {
  const obj = (raw ?? {}) as Partial<MemberStatsRaw>;
  if (!Array.isArray(obj.members)) throw new Error("memberStats: expected a `members` array");

  const members = obj.members.map((m): MemberStats => {
    const r = m as Record<string, unknown>;
    return {
      name: toStr(r.name) ?? "",
      gamesPlayed: toNum(r.gamesPlayed),
      winRate: toNum(r.winRate),
      goals: toNum(r.goals),
      assists: toNum(r.assists),
      cleanSheetsDef: toNum(r.cleanSheetsDef),
      cleanSheetsGK: toNum(r.cleanSheetsGK),
      shotSuccessRate: toNum(r.shotSuccessRate),
      passesMade: toNum(r.passesMade),
      passSuccessRate: toNum(r.passSuccessRate),
      ratingAve: toNum(r.ratingAve),
      tacklesMade: toNum(r.tacklesMade),
      tackleSuccessRate: toNum(r.tackleSuccessRate),
      manOfTheMatch: toNum(r.manOfTheMatch),
      redCards: toNum(r.redCards),
      proName: toStr(r.proName),
      proPos: toNum(r.proPos),
      proStyle: toNum(r.proStyle),
      proHeight: toNum(r.proHeight),
      proNationality: toNum(r.proNationality),
      proOverall: toNum(r.proOverall),
      favoritePosition: toStr(r.favoritePosition),
      prevGoals: PREV_GOAL_KEYS.map((k) => toNum(r[k])),
    };
  });

  return { members, positionCount: obj.positionCount ?? {} };
}

// ---------------------------------------------------------------------------------------------
// matches (clubs/matches, both matchType values). Shape from a real league-match sample the user
// pasted on 2026-11-11 (fixtures/matches.sample.json, trimmed). The playoffMatch shape is assumed to
// match but was empty for the test club, so it is unverified.
// ---------------------------------------------------------------------------------------------

export interface MatchClub {
  clubId: string;
  name: string | null;
  goals: number | null;
  goalsAgainst: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  /** EA numeric codes. Meanings not confirmed (the sample draw had result "4", matchType "1"). */
  result: number | null;
  matchType: number | null;
  /** Unix seconds (a string in EA's payload). */
  date: number | null;
  gameNumber: number | null;
  score: number | null;
  seasonId: number | null;
  /** EA's `TEAM` field. Meaning unconfirmed. */
  teamCode: number | null;
  winnerByDnf: number | null;
  regionId: number | null;
  teamId: number | null;
}

export interface MatchPlayer {
  /** Key under `players[clubId]` in EA's payload. A long numeric id, kept as a string. */
  playerId: string;
  name: string;
  /** e.g. "forward", "midfielder". */
  pos: string | null;
  goals: number | null;
  assists: number | null;
  /** Match rating, e.g. 7.1. */
  rating: number | null;
  shots: number | null;
  passAttempts: number | null;
  passesMade: number | null;
  tackleAttempts: number | null;
  tacklesMade: number | null;
  saves: number | null;
  goalsConceded: number | null;
  cleanSheetsDef: number | null;
  cleanSheetsGK: number | null;
  /** 1 if man of the match. */
  mom: number | null;
  redCards: number | null;
  secondsPlayed: number | null;
  /** EA `archetypeid`. Meaning unconfirmed. */
  archetypeId: number | null;
  /** Platform family code: 1 PlayStation, 2 Xbox, 3 PC, 4 Nintendo, 0 on friendlies (proclubs-sdk, unconfirmed by EA). */
  namespace: number | null;
  gameTime: number | null;
  realTimeGame: number | null;
  realTimeIdle: number | null;
  cleanSheetsAny: number | null;
  /** Goalkeeper save breakdown. No keeper has appeared in our samples, so these are always 0 so far. */
  ballDiveSaves: number | null;
  crossSaves: number | null;
  goodDirectionSaves: number | null;
  parrySaves: number | null;
  punchSaves: number | null;
  reflexSaves: number | null;
  score: number | null;
  userResult: number | null;
  wins: number | null;
  losses: number | null;
  vproAttr: string | null;
  vproHackReason: number | null;
  /**
   * EA's `match_event_aggregate_0..3`, VERBATIM and in order (empty string when absent). Coded
   * "eventId:count,..." strings whose event ids are unexplained. They look like consecutive chunks of one
   * long string, but a chunk boundary could in principle split a pair, so they are NOT merged or parsed.
   * Kept so captures lose nothing; interpret later once the ids are understood.
   */
  eventAggregate: string[];
}

export interface Match {
  matchId: string;
  /** Unix seconds. */
  timestamp: number | null;
  /**
   * Clubs EA lists under `clubs`. A fixture from 2026-11-11 first showed only the requested club, but a
   * second response for the same match listed BOTH clubs (with `details.name`), so the opponent's name
   * usually IS available. Don't assume it: EA's earlier payload for this match omitted it, so handle a
   * missing opponent entry. Players are always grouped under `players` for both clubs.
   */
  clubs: Record<string, MatchClub>;
  /** Players grouped by clubId, including clubs missing from `clubs`. */
  players: Record<string, MatchPlayer[]>;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseMatchPlayer(playerId: string, r: Record<string, unknown>): MatchPlayer {
  return {
    playerId,
    name: toStr(r.playername) ?? "",
    pos: toStr(r.pos),
    goals: toNum(r.goals),
    assists: toNum(r.assists),
    rating: toNum(r.rating),
    shots: toNum(r.shots),
    passAttempts: toNum(r.passattempts),
    passesMade: toNum(r.passesmade),
    tackleAttempts: toNum(r.tackleattempts),
    tacklesMade: toNum(r.tacklesmade),
    saves: toNum(r.saves),
    goalsConceded: toNum(r.goalsconceded),
    cleanSheetsDef: toNum(r.cleansheetsdef),
    cleanSheetsGK: toNum(r.cleansheetsgk),
    mom: toNum(r.mom),
    redCards: toNum(r.redcards),
    secondsPlayed: toNum(r.secondsPlayed),
    archetypeId: toNum(r.archetypeid),
    namespace: toNum(r.namespace),
    gameTime: toNum(r.gameTime),
    realTimeGame: toNum(r.realtimegame),
    realTimeIdle: toNum(r.realtimeidle),
    cleanSheetsAny: toNum(r.cleansheetsany),
    ballDiveSaves: toNum(r.ballDiveSaves),
    crossSaves: toNum(r.crossSaves),
    goodDirectionSaves: toNum(r.goodDirectionSaves),
    parrySaves: toNum(r.parrySaves),
    punchSaves: toNum(r.punchSaves),
    reflexSaves: toNum(r.reflexSaves),
    score: toNum(r.SCORE),
    userResult: toNum(r.userResult),
    wins: toNum(r.wins),
    losses: toNum(r.losses),
    vproAttr: toStr(r.vproattr),
    vproHackReason: toNum(r.vprohackreason),
    eventAggregate: [0, 1, 2, 3].map((i) => {
      const v = r[`match_event_aggregate_${i}`];
      return typeof v === "string" ? v : "";
    }),
  };
}

/**
 * Deliberately NOT kept: `customKit` (cosmetic), `timeAgo` (derived from the timestamp) and EA's
 * `aggregate` block (sums over players that can be recomputed from the player rows; its `rating` is a sum,
 * not an average). Everything else per player and per club is kept; the coded event strings are kept verbatim.
 */
export function parseMatches(raw: unknown): Match[] {
  if (!Array.isArray(raw)) throw new Error("matches: expected an array");

  return raw.map((m): Match => {
    const r = (isObj(m) ? m : {}) as Record<string, unknown>;

    const clubs: Record<string, MatchClub> = {};
    if (isObj(r.clubs)) {
      for (const [clubId, c] of Object.entries(r.clubs)) {
        if (!isObj(c)) continue;
        const d = isObj(c.details) ? c.details : {};
        clubs[clubId] = {
          clubId,
          name: toStr(d.name),
          goals: toNum(c.goals),
          goalsAgainst: toNum(c.goalsAgainst),
          wins: toNum(c.wins),
          losses: toNum(c.losses),
          ties: toNum(c.ties),
          result: toNum(c.result),
          matchType: toNum(c.matchType),
          date: toNum(c.date),
          gameNumber: toNum(c.gameNumber),
          score: toNum(c.score),
          seasonId: toNum(c.season_id),
          teamCode: toNum(c.TEAM),
          winnerByDnf: toNum(c.winnerByDnf),
          regionId: toNum(d.regionId),
          teamId: toNum(d.teamId),
        };
      }
    }

    const players: Record<string, MatchPlayer[]> = {};
    if (isObj(r.players)) {
      for (const [clubId, byPlayer] of Object.entries(r.players)) {
        if (!isObj(byPlayer)) continue;
        players[clubId] = Object.entries(byPlayer)
          .filter((e): e is [string, Record<string, unknown>] => isObj(e[1]))
          .map(([playerId, p]) => parseMatchPlayer(playerId, p));
      }
    }

    return { matchId: toStr(r.matchId) ?? "", timestamp: toNum(r.timestamp), clubs, players };
  });
}

// ---------------------------------------------------------------------------------------------
// overallStats (clubs/overallStats). Shape from a real sample the user pasted on 2026-11-11
// (fixtures/overallStats.sample.json). Top level is an array with one entry per requested clubId.
// ---------------------------------------------------------------------------------------------

export interface DivisionFinish {
  division: number;
  group: number;
  count: number;
}

export interface RecentMatch {
  /**
   * EA result code in `lastMatchN`. Inferred from two clubs' data, not documented by EA: 1 = win,
   * 2 = loss, 3 = tie. Club 914493 (3W 2T) had recent codes 1,1,1,3,3 (a 3-3 draw was code 3), and club
   * 991650 (8W 2T 28L, unbeaten streak 0) had five recent codes of 2. Still few samples, so keep
   * treating these as likely rather than certain. NOT the same codes as `result` in the matches payload.
   */
  resultCode: number;
  opponentClubId: string;
}

export interface OverallStats {
  clubId: string;
  gamesPlayed: number | null;
  gamesPlayedPlayoff: number | null;
  wins: number | null;
  ties: number | null;
  losses: number | null;
  goals: number | null;
  goalsAgainst: number | null;
  promotions: number | null;
  relegations: number | null;
  /** Null when the club has no division history (null in the sample). */
  bestDivision: number | null;
  bestFinishGroup: number | null;
  finishes: DivisionFinish[];
  winStreak: number | null;
  unbeatenStreak: number | null;
  skillRating: number | null;
  reputationTier: number | null;
  leagueAppearances: number | null;
  /** Most recent first (lastMatch0 / lastOpponent0). Entries EA marks with -1 are dropped. */
  recentMatches: RecentMatch[];
  /**
   * Every real `lastOpponentN` id, most recent first. EA returns up to 10 opponents but results for only
   * the 5 most recent, so this can be longer than `recentMatches`.
   */
  opponentHistory: string[];
}

export function parseOverallStats(raw: unknown): OverallStats[] {
  if (!Array.isArray(raw)) throw new Error("overallStats: expected an array");

  return raw.map((item): OverallStats => {
    const r = (isObj(item) ? item : {}) as Record<string, unknown>;

    const finishes: DivisionFinish[] = [];
    for (const [k, v] of Object.entries(r)) {
      const m = /^finishesInDivision(\d+)Group(\d+)$/.exec(k);
      const count = toNum(v);
      if (m && count !== null) finishes.push({ division: Number(m[1]), group: Number(m[2]), count });
    }
    finishes.sort((a, b) => a.division - b.division || a.group - b.group);

    const recentMatches: RecentMatch[] = [];
    for (let i = 0; i < 10; i++) {
      const code = toNum(r[`lastMatch${i}`]);
      const opp = toStr(r[`lastOpponent${i}`]);
      if (code === null || code < 0 || opp === null || opp === "-1") continue;
      recentMatches.push({ resultCode: code, opponentClubId: opp });
    }

    const opponentHistory: string[] = [];
    for (let i = 0; i < 10; i++) {
      const opp = toStr(r[`lastOpponent${i}`]);
      if (opp !== null && opp !== "-1") opponentHistory.push(opp);
    }

    return {
      clubId: toStr(r.clubId) ?? "",
      gamesPlayed: toNum(r.gamesPlayed),
      gamesPlayedPlayoff: toNum(r.gamesPlayedPlayoff),
      wins: toNum(r.wins),
      ties: toNum(r.ties),
      losses: toNum(r.losses),
      goals: toNum(r.goals),
      goalsAgainst: toNum(r.goalsAgainst),
      promotions: toNum(r.promotions),
      relegations: toNum(r.relegations),
      bestDivision: toNum(r.bestDivision),
      bestFinishGroup: toNum(r.bestFinishGroup),
      finishes,
      winStreak: toNum(r.wstreak),
      unbeatenStreak: toNum(r.unbeatenstreak),
      skillRating: toNum(r.skillRating),
      reputationTier: toNum(r.reputationtier),
      leagueAppearances: toNum(r.leagueAppearances),
      recentMatches,
      opponentHistory,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// memberCareerStats (members/career/stats). Shape from a real sample the user pasted on 2026-11-11
// (fixtures/memberCareerStats.sample.json). Same envelope as memberStats but with far fewer fields:
// no passing, tackling, shooting, clean-sheet or red-card data.
// ---------------------------------------------------------------------------------------------

export interface MemberCareerStats {
  name: string;
  gamesPlayed: number | null;
  goals: number | null;
  assists: number | null;
  manOfTheMatch: number | null;
  /** Career average match rating, e.g. 8.8. */
  ratingAve: number | null;
  /** EA numeric position code (e.g. 25, 14). Not mapped to a name. */
  proPos: number | null;
  favoritePosition: string | null;
  /** Meaning unconfirmed (same field as in memberStats, but only the single `prevGoals` value here). */
  prevGoals: number | null;
}

export interface MemberCareerStatsResult {
  members: MemberCareerStats[];
  positionCount: Partial<Record<Position, number>>;
}

export function parseMemberCareerStats(raw: unknown): MemberCareerStatsResult {
  const obj = (isObj(raw) ? raw : {}) as Partial<MemberStatsRaw>;
  if (!Array.isArray(obj.members)) throw new Error("memberCareerStats: expected a `members` array");

  const members = obj.members.map((m): MemberCareerStats => {
    const r = (isObj(m) ? m : {}) as Record<string, unknown>;
    return {
      name: toStr(r.name) ?? "",
      gamesPlayed: toNum(r.gamesPlayed),
      goals: toNum(r.goals),
      assists: toNum(r.assists),
      manOfTheMatch: toNum(r.manOfTheMatch),
      ratingAve: toNum(r.ratingAve),
      proPos: toNum(r.proPos),
      favoritePosition: toStr(r.favoritePosition),
      prevGoals: toNum(r.prevGoals),
    };
  });

  return { members, positionCount: obj.positionCount ?? {} };
}

// ---------------------------------------------------------------------------------------------
// clubInfo, search, searchCurrentSeason, currentSeasonLeaderboard, playoffAchievements.
// Shapes from real samples pasted on 2026-11-11 (fixtures/*.sample.json, kit data trimmed).
// ---------------------------------------------------------------------------------------------

export interface ClubInfo {
  clubId: string;
  name: string | null;
  regionId: number | null;
  teamId: number | null;
  /** From customKit.stadName. The rest of customKit (kit and crest ids and colours) is cosmetic and dropped. */
  stadiumName: string | null;
}

function parseClubInfoEntry(clubId: string, c: Record<string, unknown>): ClubInfo {
  return {
    clubId,
    name: toStr(c.name),
    regionId: toNum(c.regionId),
    teamId: toNum(c.teamId),
    stadiumName: isObj(c.customKit) ? toStr(c.customKit.stadName) : null,
  };
}

/** `clubs/info` returns an object keyed by clubId (not an array). Returns the clubs in key order. */
export function parseClubInfo(raw: unknown): ClubInfo[] {
  if (!isObj(raw)) throw new Error("clubInfo: expected an object keyed by clubId");
  return Object.entries(raw)
    .filter((e): e is [string, Record<string, unknown>] => isObj(e[1]))
    .map(([clubId, c]) => parseClubInfoEntry(clubId, c));
}

/** One club's headline record, as returned by search, searchCurrentSeason and the leaderboard. */
export interface ClubRecord {
  clubId: string;
  /** From `clubName`, falling back to `clubInfo.name`. */
  name: string;
  platform: string | null;
  currentDivision: number | null;
  /**
   * Caution: `search` (all-time) and `searchCurrentSeason` disagreed for one club (all-time showed fewer
   * games than the season list), and the leaderboard values look like lifetime totals. Treat the absolute
   * numbers as unverified. Field semantics are unconfirmed.
   */
  gamesPlayed: number | null;
  gamesPlayedPlayoff: number | null;
  wins: number | null;
  ties: number | null;
  losses: number | null;
  goals: number | null;
  goalsAgainst: number | null;
  cleanSheets: number | null;
  /** Absent from the leaderboard, so null there. */
  points: number | null;
  promotions: number | null;
  relegations: number | null;
  bestDivision: number | null;
  reputationTier: number | null;
  regionId: number | null;
  teamId: number | null;
}

function parseClubRecord(r: Record<string, unknown>): ClubRecord {
  const info = isObj(r.clubInfo) ? r.clubInfo : {};
  return {
    clubId: toStr(r.clubId) ?? "",
    name: toStr(r.clubName) ?? toStr(info.name) ?? "",
    platform: toStr(r.platform),
    currentDivision: toNum(r.currentDivision),
    gamesPlayed: toNum(r.gamesPlayed),
    gamesPlayedPlayoff: toNum(r.gamesPlayedPlayoff),
    wins: toNum(r.wins),
    ties: toNum(r.ties),
    losses: toNum(r.losses),
    goals: toNum(r.goals),
    goalsAgainst: toNum(r.goalsAgainst),
    cleanSheets: toNum(r.cleanSheets),
    points: toNum(r.points),
    promotions: toNum(r.promotions),
    relegations: toNum(r.relegations),
    bestDivision: toNum(r.bestDivision),
    reputationTier: toNum(r.reputationtier),
    regionId: toNum(info.regionId),
    teamId: toNum(info.teamId),
  };
}

/** Serves both `search` (all-time) and `searchCurrentSeason`, which have the same shape. */
export function parseClubSearch(raw: unknown): ClubRecord[] {
  if (!Array.isArray(raw)) throw new Error("club search: expected an array");
  return raw.map((e) => parseClubRecord((isObj(e) ? e : {}) as Record<string, unknown>));
}

export interface LeaderboardEntry extends ClubRecord {
  /** A real number in EA's payload (not a string). */
  rank: number | null;
  skillRating: number | null;
  goalsPerGame: number | null;
  goalsAgainstPerGame: number | null;
  reputationLevel: number | null;
  bestFinishGroup: number | null;
}

export function parseLeaderboard(raw: unknown): LeaderboardEntry[] {
  if (!Array.isArray(raw)) throw new Error("leaderboard: expected an array");
  return raw.map((e): LeaderboardEntry => {
    const r = (isObj(e) ? e : {}) as Record<string, unknown>;
    return {
      ...parseClubRecord(r),
      rank: toNum(r.rank),
      skillRating: toNum(r.skillRating),
      goalsPerGame: toNum(r.goalsPerGame),
      goalsAgainstPerGame: toNum(r.goalsAgainstPerGame),
      reputationLevel: toNum(r.reputationlevel),
      bestFinishGroup: toNum(r.bestFinishGroup),
    };
  });
}

/**
 * playoffAchievements: the only sample was an empty array (club 492098 had 13 playoff games yet still
 * returned []), so the entry shape is UNKNOWN. This validates the envelope and passes entries through
 * untouched. Do not add fields until a non-empty sample exists.
 */
export function parsePlayoffAchievements(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("playoffAchievements: expected an array");
  return raw;
}
