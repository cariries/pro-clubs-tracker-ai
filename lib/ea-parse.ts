// Maps each public proxy endpoint name (keys of ENDPOINTS in ea.ts) to its parser in ea-types.ts.
// A parser failure never throws out of here: callers still get the raw payload plus a parseError, so an
// unannounced EA shape change degrades to "raw only" instead of a 500.
import {
  parseClubInfo,
  parseClubSearch,
  parseLeaderboard,
  parseMatches,
  parseMemberCareerStats,
  parseMemberStats,
  parseOverallStats,
  parsePlayoffAchievements,
} from "./ea-types";

const PARSERS: Record<string, (raw: unknown) => unknown> = {
  search: parseClubSearch,
  searchCurrentSeason: parseClubSearch,
  clubInfo: parseClubInfo,
  overallStats: parseOverallStats,
  memberStats: parseMemberStats,
  memberCareerStats: parseMemberCareerStats,
  matches: parseMatches,
  playoffAchievements: parsePlayoffAchievements,
  currentSeasonLeaderboard: parseLeaderboard,
  allTimeLeaderboard: parseLeaderboard,
};

export type ParsedResult =
  | { parsed: unknown; parseError: null }
  | { parsed: null; parseError: string };

export function parseEaResponse(endpoint: string, raw: unknown): ParsedResult {
  const parser = Object.hasOwn(PARSERS, endpoint) ? PARSERS[endpoint] : undefined;
  if (!parser) return { parsed: null, parseError: "no parser for this endpoint" };
  try {
    return { parsed: parser(raw), parseError: null };
  } catch (err) {
    return { parsed: null, parseError: err instanceof Error ? err.message : "parse failed" };
  }
}

export const PARSED_ENDPOINTS = Object.keys(PARSERS);
