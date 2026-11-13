// Builds SAVED-CLUB inputs with hand-chosen numbers, so tests can assert exact expected values. The
// payloads are shaped exactly like captureClub's output (parsed data under `parts`), but the numbers
// are invented, never EA data.
import type { ClubInput } from "@/lib/club-compare";

export interface PlayerSpec {
  name: string;
  games: number;
  goals: number;
  assists?: number;
  rating?: number;
  motm?: number;
  pos?: string;
  passPct?: number;
  shotPct?: number;
  tacklePct?: number;
}

export interface ClubSpec {
  id: string;
  clubId: string;
  name?: string | null;
  label?: string;
  platform?: string;
  savedAt?: string;
  /** Newest EA match as unix seconds; default = 1 day before savedAt. */
  newestMatchTs?: number | null;
  record?: { games: number; wins: number; ties: number; losses: number; goals: number; goalsAgainst: number } | null;
  skillRating?: number | null;
  winStreak?: number;
  unbeatenStreak?: number;
  players?: PlayerSpec[] | null;
  /** League match scores for the club, newest first: [goalsFor, goalsAgainst]. */
  scores?: Array<[number, number]>;
  /** Override part statuses, for failed/empty parts. */
  statuses?: Partial<Record<"clubInfo" | "overallStats" | "memberStats" | "memberCareerStats" | "leagueMatches" | "playoffMatches", "ok" | "empty" | "failed">>;
}

const DAY = 86_400;

export function club(spec: ClubSpec): ClubInput {
  const platform = spec.platform ?? "common-gen5";
  const savedAt = spec.savedAt ?? "2026-11-12T10:00:00.000Z";
  const savedTs = Math.floor(Date.parse(savedAt) / 1000);
  const newest = spec.newestMatchTs === undefined ? savedTs - DAY : spec.newestMatchTs;
  const st = spec.statuses ?? {};
  const name = spec.name === undefined ? `Club ${spec.clubId}` : spec.name;

  const parts: Record<string, unknown> = {
    clubInfo: st.clubInfo === "failed" ? { status: "failed", error: "timeout" } : { status: st.clubInfo ?? "ok", data: name === null ? [{ clubId: spec.clubId }] : [{ clubId: spec.clubId, name }] },
    overallStats:
      st.overallStats === "failed" || spec.record === null
        ? { status: "failed", error: "timeout" }
        : {
            status: st.overallStats ?? "ok",
            data: [
              {
                clubId: spec.clubId,
                gamesPlayed: spec.record!.games,
                wins: spec.record!.wins,
                ties: spec.record!.ties,
                losses: spec.record!.losses,
                goals: spec.record!.goals,
                goalsAgainst: spec.record!.goalsAgainst,
                skillRating: spec.skillRating ?? null,
                winStreak: spec.winStreak ?? 0,
                unbeatenStreak: spec.unbeatenStreak ?? 0,
              },
            ],
          },
    memberStats:
      st.memberStats === "failed" || spec.players === null
        ? { status: "failed", error: "timeout" }
        : {
            status: st.memberStats ?? "ok",
            data: {
              members: (spec.players ?? []).map((p) => ({
                name: p.name,
                favoritePosition: p.pos ?? "forward",
                gamesPlayed: p.games,
                goals: p.goals,
                assists: p.assists ?? 0,
                ratingAve: p.rating ?? 7,
                manOfTheMatch: p.motm ?? 0,
                passSuccessRate: p.passPct ?? null,
                shotSuccessRate: p.shotPct ?? null,
                tackleSuccessRate: p.tacklePct ?? null,
              })),
              positionCount: {},
            },
          },
    memberCareerStats: { status: "ok", data: { members: [], positionCount: {} } },
    leagueMatches: st.leagueMatches === "failed" ? { status: "failed", error: "timeout" } : {
      status: st.leagueMatches ?? ((spec.scores ?? []).length ? "ok" : "empty"),
      data: (spec.scores ?? []).map(([gf, ga], i) => ({
        matchId: `${spec.clubId}-m${i}`,
        timestamp: (newest ?? savedTs) - i * 3600,
        clubs: { [spec.clubId]: { clubId: spec.clubId, goals: gf, goalsAgainst: ga }, "999": { clubId: "999", goals: ga, goalsAgainst: gf } },
        players: {},
      })),
    },
    playoffMatches: { status: "empty" },
  };

  return {
    id: spec.id,
    label: spec.label ?? `Saved ${spec.clubId}`,
    createdAt: savedAt,
    clubId: spec.clubId,
    platform,
    data: JSON.parse(JSON.stringify({ capturedAt: savedAt, newestMatchTimestamp: newest, parts })),
  };
}

/** Three clubs with deliberately different strengths. 20 games each so nothing is "thin" by default. */
export const STRONG = (over: Partial<ClubSpec> = {}): ClubSpec => ({
  id: "c-strong", clubId: "100", name: "Strong FC", skillRating: 2000,
  record: { games: 20, wins: 15, ties: 3, losses: 2, goals: 60, goalsAgainst: 20 },
  scores: [[3, 0], [2, 1], [1, 1], [4, 0], [2, 0], [1, 0], [3, 1], [0, 1], [2, 2], [5, 0]],
  players: [
    { name: "Ace", games: 20, goals: 30, assists: 5, rating: 8.5, motm: 6 },
    { name: "Wing", games: 18, goals: 9, assists: 12, rating: 7.8, motm: 2 },
    { name: "Rookie", games: 3, goals: 6, assists: 0, rating: 9.5, motm: 1 },
  ],
  ...over,
});
export const MIDDLE = (over: Partial<ClubSpec> = {}): ClubSpec => ({
  id: "c-middle", clubId: "200", name: "Middle United", skillRating: 1500,
  record: { games: 20, wins: 8, ties: 4, losses: 8, goals: 30, goalsAgainst: 30 },
  scores: [[1, 0], [0, 2], [1, 1], [2, 1], [0, 0], [1, 3], [2, 0], [0, 1], [1, 1], [3, 2]],
  players: [
    { name: "Mid", games: 20, goals: 10, assists: 8, rating: 7.2, motm: 2 },
    { name: "Back", games: 20, goals: 1, assists: 2, rating: 6.9, motm: 0 },
  ],
  ...over,
});
export const WEAK = (over: Partial<ClubSpec> = {}): ClubSpec => ({
  id: "c-weak", clubId: "300", name: "Weak Town", skillRating: 1000,
  record: { games: 20, wins: 3, ties: 2, losses: 15, goals: 15, goalsAgainst: 55 },
  scores: [[0, 3], [0, 2], [1, 1], [0, 4], [1, 2], [0, 1], [2, 2], [0, 3], [1, 0], [0, 5]],
  players: [{ name: "Solo", games: 20, goals: 8, assists: 1, rating: 6.1, motm: 0 }],
  ...over,
});
