// Recent league matches for charts and the AI. The reader works on the STORED capture (after our parser), so the first
// tests use a REAL capture built from the saved EA fixtures. Hand-built matches then pin the arithmetic and the edge cases.
import { describe, expect, it } from "vitest";
import { MIN_TREND_APPEARANCES, RECENT_MATCHES, TREND_MEMBERS_MAX, formString, readRecentMatches, trendMembers } from "@/lib/recent-matches";
import { captureClub } from "@/lib/club-capture";
import { baseEa, mockEa } from "./helpers";

const ME = "100";
const OPP = "200";
const mk = (i: number, gf: number, ga: number, players: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) => ({
  matchId: `m${i}`,
  timestamp: 1_800_000_000 + i * 3600, // higher i = newer
  clubs: { [ME]: { goals: gf, goalsAgainst: ga, name: "Mine" }, [OPP]: { goals: ga, goalsAgainst: gf, name: `Opp${i}` } },
  players: { [ME]: players, [OPP]: [] },
  ...extra,
});
const p = (name: string, goals: number, assists: number, rating: number, made = 8, att = 10) => ({ name, goals, assists, rating, passesMade: made, passAttempts: att });
const data = (matches: unknown[]) => ({ parts: { leagueMatches: { status: "ok", data: matches } } });

describe("a REAL capture (the stored shape, not EA's raw shape)", () => {
  it("reads the club result, the opponent's name and the members' own numbers", async () => {
    const cap = await captureClub("914493", "common-gen5", { fetchEa: mockEa(baseEa()) as never }, new Date("2026-11-12T00:00:00Z"));
    const r = readRecentMatches(JSON.parse(JSON.stringify(cap.payload)), "914493")!;
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ goalsFor: 3, goalsAgainst: 3, outcome: "D", opponent: "B1NHEAD FC" });
    expect(formString(r)).toBe("D");
    const t3nk = r.members.find((m) => m.name === "T3NK_Blackpearl")!;
    expect(t3nk.appearances).toBe(1);
    expect(t3nk.matches[0]).toMatchObject({ matchNo: 1, goals: 1, assists: 2, rating: 8.6 });
    expect(t3nk.matches[0].passPct).toBeCloseTo((25 / 27) * 100, 0); // the fixture: 25 passes of 27
    expect(r.members.map((m) => m.name)).not.toContain("Cyril_the_cat"); // the OPPONENT's player is not ours
  });
});

describe("club results and order", () => {
  it("returns the matches OLDEST first and works out W, D and L from the scores (not EA's result code)", () => {
    const r = readRecentMatches(data([mk(3, 1, 0), mk(2, 2, 2), mk(1, 0, 3)]), ME)!;
    expect(r.matches.map((m) => m.matchId)).toEqual(["m1", "m2", "m3"]);
    expect(formString(r)).toBe("LDW");
    expect(r.matches.map((m) => [m.goalsFor, m.goalsAgainst])).toEqual([[0, 3], [2, 2], [1, 0]]);
  });
  it("keeps only the newest RECENT_MATCHES, however many EA sent", () => {
    const many = Array.from({ length: 14 }, (_, i) => mk(i + 1, 1, 0));
    const r = readRecentMatches(data(many), ME)!;
    expect(r.matches).toHaveLength(RECENT_MATCHES);
    expect(r.matches[0].matchId).toBe("m5");
    expect(r.matches[RECENT_MATCHES - 1].matchId).toBe("m14");
  });
  it("is not fooled by input order: the NEWEST win even when EA lists them oldest first", () => {
    const shuffled = [mk(1, 0, 1), mk(5, 3, 0), mk(3, 2, 2)];
    expect(readRecentMatches(data(shuffled), ME)!.matches.map((m) => m.matchId)).toEqual(["m1", "m3", "m5"]);
  });
  it("a match with no timestamp keeps EA's order (newest first) instead of crashing", () => {
    const a = { ...mk(1, 1, 0), timestamp: null };
    const b = { ...mk(2, 0, 1), timestamp: null };
    expect(readRecentMatches(data([a, b]), ME)!.matches.map((m) => m.matchId)).toEqual(["m2", "m1"]);
  });
  it("skips a match whose score is missing, and counts it", () => {
    const bad = { ...mk(2, 0, 0), clubs: { [ME]: { name: "Mine" } } };
    const r = readRecentMatches(data([mk(1, 1, 0), bad, null, "x", 5]), ME)!;
    expect(r.matches).toHaveLength(1);
    expect(r.skipped).toBe(4);
  });
  it("uses the opponent's id when EA gave no name, and null when there is no opponent at all", () => {
    const noName = { ...mk(1, 1, 0), clubs: { [ME]: { goals: 1, goalsAgainst: 0 }, [OPP]: { goals: 0, goalsAgainst: 1 } } };
    expect(readRecentMatches(data([noName]), ME)!.matches[0].opponent).toBe(OPP);
    const alone = { ...mk(1, 1, 0), clubs: { [ME]: { goals: 1, goalsAgainst: 0 } }, players: { [ME]: [] } };
    expect(readRecentMatches(data([alone]), ME)!.matches[0].opponent).toBeNull();
  });
  it("a 0-0 draw is a D, a 1-0 is a W, a 0-1 is an L", () => {
    expect(formString(readRecentMatches(data([mk(3, 0, 0), mk(2, 1, 0), mk(1, 0, 1)]), ME)!)).toBe("LWD");
  });
});

describe("member trends", () => {
  const ms = [
    mk(1, 1, 0, [p("Ace", 1, 0, 8), p("Wing", 0, 1, 7)]),
    mk(2, 1, 0, [p("Ace", 2, 1, 9)]),
    mk(3, 1, 0, [p("Ace", 0, 0, 6.5, 5, 10), p("Wing", 1, 0, 7.5), p("Rookie", 0, 0, 6)]),
    mk(4, 1, 0, [p("Ace", 1, 1, 8), p("Wing", 0, 0, 7)]),
  ];
  const r = readRecentMatches(data(ms), ME)!;
  it("collects each member's own matches in time order, with the match number", () => {
    const ace = r.members.find((m) => m.name === "Ace")!;
    expect(ace.matches.map((m) => m.matchNo)).toEqual([1, 2, 3, 4]);
    expect(ace.matches.map((m) => m.goals)).toEqual([1, 2, 0, 1]);
    expect(ace.matches.map((m) => m.rating)).toEqual([8, 9, 6.5, 8]);
  });
  it("a member who sat out a match shows a GAP (the match numbers skip), not a zero", () => {
    const wing = r.members.find((m) => m.name === "Wing")!;
    expect(wing.matches.map((m) => m.matchNo)).toEqual([1, 3, 4]);
    expect(wing.appearances).toBe(3);
  });
  it("totals and the average rating are computed from the appearances only", () => {
    const ace = r.members.find((m) => m.name === "Ace")!;
    expect(ace.totalGoals).toBe(4);
    expect(ace.totalAssists).toBe(2);
    expect(ace.avgRating).toBe(7.9); // (8 + 9 + 6.5 + 8) / 4 = 7.875 -> 7.9
  });
  it("pass percentage per match is made / attempts, and null with no attempts", () => {
    const ace = r.members.find((m) => m.name === "Ace")!;
    expect(ace.matches[2].passPct).toBe(50);
    const none = readRecentMatches(data([mk(1, 1, 0, [p("Z", 0, 0, 7, 0, 0)])]), ME)!;
    expect(none.members[0].matches[0].passPct).toBeNull();
  });
  it("busiest first, ties by name; the opponent's players are never included", () => {
    expect(r.members.map((m) => m.name)).toEqual(["Ace", "Wing", "Rookie"]);
    const withOpp = { ...mk(1, 1, 0, [p("Mine1", 1, 0, 8)]), players: { [ME]: [p("Mine1", 1, 0, 8)], [OPP]: [p("Enemy", 5, 5, 10)] } };
    expect(readRecentMatches(data([withOpp]), ME)!.members.map((m) => m.name)).toEqual(["Mine1"]);
  });
  it("trendMembers keeps only members with enough appearances, busiest first, capped", () => {
    expect(trendMembers(r).map((m) => m.name)).toEqual(["Ace", "Wing"]); // Rookie has 1 appearance
    expect(MIN_TREND_APPEARANCES).toBe(3);
    const crowd = Array.from({ length: 12 }, (_, i) => p(`P${String(i).padStart(2, "0")}`, 0, 0, 7));
    const big = readRecentMatches(data([mk(1, 1, 0, crowd), mk(2, 1, 0, crowd), mk(3, 1, 0, crowd)]), ME)!;
    expect(trendMembers(big)).toHaveLength(TREND_MEMBERS_MAX);
  });
  it("a missing rating or goals field is null, never zero, and does not break the totals", () => {
    const odd = readRecentMatches(data([mk(1, 1, 0, [{ name: "Odd", goals: null, assists: 2, rating: null, passesMade: null, passAttempts: null }])]), ME)!;
    expect(odd.members[0].matches[0]).toMatchObject({ goals: null, rating: null, passPct: null });
    expect(odd.members[0].avgRating).toBeNull();
    expect(odd.members[0].totalAssists).toBe(2);
  });
});

describe("junk and missing data never throws", () => {
  it.each([
    ["no parts", {}],
    ["null", null],
    ["a string", "x"],
    ["parts not an object", { parts: 5 }],
    ["leagueMatches missing", { parts: {} }],
    ["leagueMatches failed", { parts: { leagueMatches: { status: "failed", error: "timeout" } } }],
    ["leagueMatches empty", { parts: { leagueMatches: { status: "empty" } } }],
    ["data not a list", { parts: { leagueMatches: { status: "ok", data: {} } } }],
    ["an empty list", data([])],
    ["only unreadable matches", data([null, {}, { clubs: 5 }])],
  ])("%s gives null", (_n, d) => {
    expect(readRecentMatches(d, ME)).toBeNull();
  });
  it("players not a list or with junk entries is tolerated", () => {
    const r = readRecentMatches(data([{ ...mk(1, 1, 0), players: { [ME]: "x" } }, { ...mk(2, 1, 0), players: { [ME]: [null, 5, {}, { name: "" }, p("Ok", 1, 0, 7)] } }]), ME)!;
    expect(r.members.map((m) => m.name)).toEqual(["Ok"]);
  });
  it("does not change the input", () => {
    const d = data([mk(2, 1, 0, [p("A", 1, 0, 8)]), mk(1, 0, 1, [p("A", 0, 0, 7)])]);
    const copy = JSON.parse(JSON.stringify(d));
    readRecentMatches(d, ME);
    expect(d).toEqual(copy);
  });
});
