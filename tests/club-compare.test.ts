import { describe, expect, it } from "vitest";
import { BOARD_LABEL, METRIC_LABEL, MAX_CLUBS, MEMBERS_PER_CLUB, MEMBERS_SINGLE, MIN_CLUBS, MIN_TO_COMPARE, compareClubs, competitionRanks, describeWarning, WARNING_CODES, type ComparisonWarning, type ClubComparison } from "@/lib/club-compare";
import { MIDDLE, STRONG, WEAK, club } from "./club-builders";

const trio = () => compareClubs([club(STRONG()), club(MIDDLE()), club(WEAK())]);
const metric = (c: ClubComparison, key: string) => c.metrics.find((m) => m.key === key)!;
const entry = (c: ClubComparison, key: string, id: string) => metric(c, key).entries.find((e) => e.id === id)!;
const codes = (c: ClubComparison) => c.warnings.map((w) => w.code);

describe("competitionRanks", () => {
  it("ranks higher-is-better and lower-is-better, and gives ties the same rank (1,1,3)", () => {
    const items = [{ value: 5, eligible: true }, { value: 9, eligible: true }, { value: 9, eligible: true }, { value: 1, eligible: true }];
    expect(competitionRanks(items, "higher")).toEqual([3, 1, 1, 4]);
    expect(competitionRanks(items, "lower")).toEqual([2, 3, 3, 1]);
  });
  it("skips ineligible and missing values without disturbing the others", () => {
    expect(competitionRanks([{ value: 5, eligible: true }, { value: 99, eligible: false }, { value: null, eligible: true }, { value: 7, eligible: true }], "higher")).toEqual([2, null, null, 1]);
    expect(competitionRanks([], "higher")).toEqual([]);
  });
});

describe("club-level metrics (hand-checked numbers)", () => {
  const c = trio();

  it("computes rates from the record and rounds the way the page will show them", () => {
    expect(entry(c, "winRate", "c-strong").value).toBe(75); // 15 / 20
    expect(entry(c, "winRate", "c-middle").value).toBe(40); // 8 / 20
    expect(entry(c, "winRate", "c-weak").value).toBe(15); // 3 / 20
    expect(entry(c, "goalsForPerGame", "c-strong").value).toBe(3); // 60 / 20
    expect(entry(c, "goalsAgainstPerGame", "c-weak").value).toBe(2.75); // 55 / 20
    expect(entry(c, "goalDiffPerGame", "c-strong").value).toBe(2); // (60 - 20) / 20
    expect(entry(c, "goalDiffPerGame", "c-weak").value).toBe(-2); // (15 - 55) / 20
    expect(entry(c, "skillRating", "c-middle").value).toBe(1500);
  });

  it("ranks every metric with the right direction: fewer goals against is BETTER", () => {
    expect(entry(c, "skillRating", "c-strong").rank).toBe(1);
    expect(entry(c, "skillRating", "c-weak").rank).toBe(3);
    expect(entry(c, "goalsAgainstPerGame", "c-strong").rank).toBe(1); // 1.0 per game
    expect(entry(c, "goalsAgainstPerGame", "c-weak").rank).toBe(3); // 2.75 per game
    expect(metric(c, "goalsAgainstPerGame").direction).toBe("lower");
    expect(metric(c, "skillRating").leaders).toEqual(["c-strong"]);
  });

  it("reports the gap between the best and the worst ranked club", () => {
    expect(metric(c, "skillRating").gap).toBe(1000);
    expect(metric(c, "winRate").gap).toBe(60);
    expect(metric(c, "goalsForPerGame").gap).toBe(2.25);
  });

  it("derives recent form from the stored SCORES, never from EA's result codes", () => {
    const form = c.clubs.find((x) => x.id === "c-strong")!.recentForm!;
    // scores: 3-0 W, 2-1 W, 1-1 D, 4-0 W, 2-0 W, 1-0 W, 3-1 W, 0-1 L, 2-2 D, 5-0 W
    expect(form).toMatchObject({ played: 10, wins: 7, draws: 2, losses: 1, goalsFor: 23, goalsAgainst: 6 });
    expect(form.results.join("")).toBe("WWDWWWWLDW");
    expect(entry(c, "recentWinRate", "c-strong").value).toBe(70);
  });

  it("builds a squad summary", () => {
    const sq = c.clubs.find((x) => x.id === "c-strong")!.squad!;
    expect(sq.players).toBe(3);
    expect(sq.topScorer).toEqual({ name: "Ace", goals: 30 });
    expect(sq.topAssister).toEqual({ name: "Wing", assists: 12 });
    // Rookie rates 9.5 but has 3 games, under the minimum, so the best-rated player is Ace
    expect(sq.bestRated).toEqual({ name: "Ace", rating: 8.5, games: 20 });
  });
});

describe("fairness: small samples are shown but not ranked", () => {
  it("does not rank a club with fewer than 10 league games, and says so", () => {
    const hot = MIDDLE({ id: "c-hot", clubId: "400", name: "Hot Streak", skillRating: 2500, record: { games: 3, wins: 3, ties: 0, losses: 0, goals: 12, goalsAgainst: 0 } });
    const c = compareClubs([club(STRONG()), club(WEAK()), club(hot)]);
    const win = entry(c, "winRate", "c-hot");
    expect(win.value).toBe(100); // shown...
    expect(win.rank).toBeNull(); // ...but not ranked
    expect(win.note).toBe("too_few_games");
    expect(entry(c, "winRate", "c-strong").rank).toBe(1); // the 100% club must not steal first place
    expect(entry(c, "skillRating", "c-hot").rank).toBeNull();
    expect(c.warnings).toContainEqual({ code: "thin_games", club: "Hot Streak", count: 3 });
    expect(metric(c, "winRate").leaders).toEqual(["c-strong"]);
  });

  it("does not call a lone ranked club first at anything", () => {
    const tiny = (id: string, clubId: string) => MIDDLE({ id, clubId, name: id, record: { games: 4, wins: 2, ties: 1, losses: 1, goals: 5, goalsAgainst: 3 } });
    const c = compareClubs([club(STRONG()), club(tiny("a", "401")), club(tiny("b", "402"))]);
    expect(entry(c, "winRate", "c-strong").rank).toBeNull();
    expect(entry(c, "winRate", "c-strong").note).toBe("no_peers");
    expect(metric(c, "winRate").leaders).toEqual([]);
    expect(metric(c, "winRate").gap).toBeNull();
  });

  it("needs at least 5 recent matches before ranking recent form", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE({ scores: [[1, 0], [2, 0], [3, 0]] })), club(WEAK())]);
    const e = entry(c, "recentWinRate", "c-middle");
    expect(e.value).toBe(100);
    expect(e.rank).toBeNull();
    expect(e.note).toBe("too_few_matches");
  });

  it("gives equal displayed values the same rank (a tie), not an arbitrary order", () => {
    const a = STRONG({ id: "a", clubId: "1", name: "A", skillRating: 1800 });
    const b = MIDDLE({ id: "b", clubId: "2", name: "B", skillRating: 1800 });
    const c = compareClubs([club(a), club(b), club(WEAK())]);
    expect(entry(c, "skillRating", "a").rank).toBe(1);
    expect(entry(c, "skillRating", "b").rank).toBe(1);
    expect(entry(c, "skillRating", "c-weak").rank).toBe(3);
    expect(metric(c, "skillRating").leaders.sort()).toEqual(["a", "b"]);
  });

  it("ranks by the ROUNDED value, so two clubs that look equal are tied", () => {
    // 3 wins in 8 = 37.5 %, 3 wins in 8 again but one club has 301/802 style noise: 33.4 vs 33.4 after rounding
    const a = MIDDLE({ id: "a", clubId: "1", name: "A", record: { games: 30, wins: 10, ties: 10, losses: 10, goals: 30, goalsAgainst: 30 } }); // 33.3
    const b = MIDDLE({ id: "b", clubId: "2", name: "B", record: { games: 300, wins: 100, ties: 100, losses: 100, goals: 300, goalsAgainst: 300 } }); // 33.3
    const c = compareClubs([club(a), club(b), club(STRONG())]);
    expect(entry(c, "winRate", "a").value).toBe(33.3);
    expect(entry(c, "winRate", "a").rank).toBe(entry(c, "winRate", "b").rank);
  });
});

describe("edge cases that used to slip through", () => {
  it("never shows Infinity or NaN for a club with 0 games", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE({ record: { games: 0, wins: 0, ties: 0, losses: 0, goals: 0, goalsAgainst: 0 } }))]);
    for (const m of c.metrics) {
      const e = m.entries.find((x) => x.id === "c-middle")!;
      if (m.key === "skillRating" || m.key === "recentWinRate") continue; // not derived from games played
      expect(e.value, m.key).toBeNull();
      expect(e.rank, m.key).toBeNull();
    }
    expect(JSON.stringify(c)).not.toMatch(/Infinity|NaN/);
  });

  it("uses only the 10 most recent matches for recent form, not the whole stored list", () => {
    // 12 stored matches, newest first: 10 losses then 2 old wins. Only the 10 newest count.
    const scores: Array<[number, number]> = [...Array.from({ length: 10 }, (): [number, number] => [0, 1]), [5, 0], [5, 0]];
    const form = compareClubs([club(STRONG()), club(MIDDLE({ scores }))]).clubs[1].recentForm!;
    expect(form.played).toBe(10);
    expect(form).toMatchObject({ wins: 0, losses: 10, goalsFor: 0, goalsAgainst: 10 });
  });

  it("orders equal-value players by games played (more games first), not by name", () => {
    // "Zed" has MORE games than "Amy" but sorts after her by name; both score 0.5 per game
    const a = STRONG({ players: [{ name: "Amy", games: 10, goals: 5 }, { name: "Zed", games: 20, goals: 10 }] });
    const e = compareClubs([club(a), club(MIDDLE({ players: [] }))]).playerBoards[0].entries;
    expect(e.map((x) => x.name)).toEqual(["Zed", "Amy"]);
    expect(e.map((x) => x.rank)).toEqual([1, 1]);
  });
});

describe("missing and odd data", () => {
  it("shows no_data and no rank for a club whose record could not be read, and warns", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE()), club(WEAK({ record: null }))]);
    expect(entry(c, "winRate", "c-weak").value).toBeNull();
    expect(entry(c, "winRate", "c-weak").note).toBe("no_data");
    expect(entry(c, "winRate", "c-weak").rank).toBeNull();
    expect(c.usableClubs).toBe(2);
    expect(c.warnings).toContainEqual({ code: "part_missing", club: "Weak Town", part: "overallStats" });
    expect(entry(c, "winRate", "c-strong").rank).toBe(1);
  });

  it("warns when there are fewer than 2 usable clubs", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE({ record: null }))]);
    expect(codes(c)).toContain("not_enough_clubs");
    expect(c.warnings.find((w) => w.code === "not_enough_clubs")!.count).toBe(1);
  });

  it("falls back to the label when EA gave no club name", () => {
    const c = compareClubs([club(STRONG({ name: null, label: "My main club" })), club(MIDDLE())]);
    expect(c.clubs[0].name).toBeNull();
    const players = c.playerBoards[0].entries.find((e) => e.name === "Ace");
    expect(players?.clubName).toBe("My main club");
  });

  it("flags a record whose wins, draws and losses do not add up", () => {
    const bad = MIDDLE({ record: { games: 20, wins: 8, ties: 4, losses: 4, goals: 30, goalsAgainst: 30 } }); // 16 != 20
    expect(codes(compareClubs([club(STRONG()), club(bad)]))).toContain("record_mismatch");
  });

  it("handles a club with a failed squad part", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE({ players: null }))]);
    expect(c.clubs[1].squad).toBeNull();
    expect(c.warnings).toContainEqual({ code: "part_missing", club: "Middle United", part: "memberStats" });
    expect(entry(c, "winRate", "c-middle").value).toBe(40); // the rest still works
  });

  it("never throws on junk data", () => {
    const junk = (id: string, data: unknown) => ({ id, label: id, createdAt: "2026-11-12T10:00:00Z", clubId: id, platform: "common-gen5", data });
    for (const d of [null, undefined, 5, "x", [], {}, { parts: null }, { parts: { overallStats: { status: "ok", data: "oops" }, memberStats: { status: "ok", data: [null, 5] }, leagueMatches: { status: "ok", data: [null, { clubs: "x" }] } } }]) {
      expect(() => compareClubs([junk("a", d), junk("b", d)])).not.toThrow();
    }
    expect(() => compareClubs([])).not.toThrow();
    expect(compareClubs([]).clubs).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [club(STRONG()), club(MIDDLE())];
    const before = JSON.stringify(input);
    compareClubs(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not depend on input order", () => {
    const a = [club(STRONG()), club(MIDDLE()), club(WEAK())];
    const b = [a[2], a[0], a[1]];
    const sortById = (c: ClubComparison) => ({ ...c, clubs: [...c.clubs].sort((x, y) => x.id.localeCompare(y.id)), metrics: c.metrics.map((m) => ({ ...m, entries: [...m.entries].sort((x, y) => x.id.localeCompare(y.id)) })) });
    expect(sortById(compareClubs(b))).toEqual(sortById(compareClubs(a)));
    expect(compareClubs(b).playerBoards).toEqual(compareClubs(a).playerBoards);
  });
});

describe("comparability warnings", () => {
  it("warns when clubs are on different platforms", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE({ platform: "nx" }))]);
    expect(c.samePlatform).toBe(false);
    expect(c.warnings).toContainEqual({ code: "mixed_platforms", platforms: ["common-gen5", "nx"] });
    expect(trio().samePlatform).toBe(true);
  });

  it("warns about stale data using each club's own saved time, and names the club", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE({ newestMatchTs: Math.floor(Date.parse("2026-09-30T17:39:37Z") / 1000) }))]);
    expect(c.clubs[1].dataAgeDays).toBe(42);
    expect(c.warnings).toContainEqual({ code: "stale_data", club: "Middle United", days: 42 });
    expect(c.warnings.some((w) => w.code === "stale_data" && w.club === "Strong FC")).toBe(false);
  });

  it("does not call a freshly played club stale", () => {
    expect(codes(trio())).not.toContain("stale_data");
  });

  it("warns when the copies were saved more than 7 days apart, but not at exactly 7", () => {
    const far = compareClubs([club(STRONG({ savedAt: "2026-11-01T10:00:00.000Z" })), club(MIDDLE({ savedAt: "2026-11-12T10:00:00.000Z" }))]);
    expect(far.warnings).toContainEqual({ code: "saved_far_apart", days: 11 });
    const edge = compareClubs([club(STRONG({ savedAt: "2026-11-05T10:00:00.000Z" })), club(MIDDLE({ savedAt: "2026-11-12T10:00:00.000Z" }))]);
    expect(codes(edge)).not.toContain("saved_far_apart");
  });

  it("keeps only the newest copy when the same club is selected twice, and says so", () => {
    const older = STRONG({ id: "old", savedAt: "2026-11-01T10:00:00.000Z", skillRating: 1111 });
    const newer = STRONG({ id: "new", savedAt: "2026-11-10T10:00:00.000Z", skillRating: 2222 });
    const c = compareClubs([club(older), club(newer), club(MIDDLE())]);
    expect(c.clubs.map((x) => x.id).sort()).toEqual(["c-middle", "new"]);
    expect(entry(c, "skillRating", "new").value).toBe(2222);
    expect(c.warnings).toContainEqual({ code: "duplicate_club", club: "Strong FC", count: 1 });
  });

  it("treats the same club id on a different platform as a different club", () => {
    const c = compareClubs([club(STRONG({ id: "a" })), club(STRONG({ id: "b", platform: "nx" }))]);
    expect(c.clubs).toHaveLength(2);
    expect(codes(c)).not.toContain("duplicate_club");
  });
});

describe("player leaderboards across clubs", () => {
  const c = trio();
  const board = (key: string) => c.playerBoards.find((b) => b.key === key)!;

  it("ranks goals per game across ALL clubs and ignores players under 5 games", () => {
    const b = board("goalsPerGame");
    expect(b.total).toBe(6);
    expect(b.eligible).toBe(5); // Rookie has 3 games
    expect(b.entries[0]).toMatchObject({ rank: 1, name: "Ace", clubName: "Strong FC", games: 20, value: 1.5 }); // 30 / 20
    expect(b.entries.map((e) => e.name)).not.toContain("Rookie"); // 2.0 per game, but only 3 games
    expect(b.entries.map((e) => e.name)).toEqual(["Ace", "Mid", "Wing", "Solo", "Back"]);
    expect(b.entries.map((e) => e.value)).toEqual([1.5, 0.5, 0.5, 0.4, 0.05]);
  });

  it("breaks ties in a stable way: equal displayed value shares a rank, more games first", () => {
    const b = board("goalsPerGame");
    // Mid: 10/20 = 0.5, Wing: 9/18 = 0.5 -> tied for rank 2, Mid listed first (20 games vs 18)
    expect(b.entries[1]).toMatchObject({ name: "Mid", rank: 2 });
    expect(b.entries[2]).toMatchObject({ name: "Wing", rank: 2 });
    expect(b.entries[3]).toMatchObject({ name: "Solo", rank: 4 });
  });

  it("ranks goal contributions, rating and man-of-the-match", () => {
    expect(board("goalContributionsPerGame").entries[0]).toMatchObject({ name: "Ace", value: 1.75 }); // (30 + 5) / 20
    expect(board("rating").entries[0]).toMatchObject({ name: "Ace", value: 8.5 });
    expect(board("motmPerGame").entries[0]).toMatchObject({ name: "Ace", value: 0.3 }); // 6 / 20
  });

  it("limits each board to 10 entries and reports how many were eligible", () => {
    const many = STRONG({ players: Array.from({ length: 15 }, (_, i) => ({ name: `P${String(i).padStart(2, "0")}`, games: 10, goals: i })) });
    const b = compareClubs([club(many), club(MIDDLE())]).playerBoards.find((x) => x.key === "goalsPerGame")!;
    expect(b.entries).toHaveLength(10);
    expect(b.eligible).toBe(17);
    expect(b.entries[0].name).toBe("P14");
  });

  it("tells two different players with the same name apart by their club", () => {
    const a = STRONG({ players: [{ name: "Sam", games: 10, goals: 10 }] });
    const b = MIDDLE({ players: [{ name: "Sam", games: 10, goals: 5 }] });
    const e = compareClubs([club(a), club(b)]).playerBoards[0].entries;
    expect(e).toHaveLength(2);
    expect(e.map((x) => x.clubName)).toEqual(["Strong FC", "Middle United"]);
  });
});

describe("pass, shot and tackle success rates (the stats that ARE stored)", () => {
  const rated = () =>
    compareClubs([
      club(STRONG({ players: [
        { name: "Passer", games: 20, goals: 1, passPct: 91, shotPct: 40, tacklePct: 50 },
        { name: "Shooter", games: 20, goals: 9, passPct: 70, shotPct: 66, tacklePct: 30 },
        { name: "NewKid", games: 3, goals: 3, passPct: 99, shotPct: 99, tacklePct: 99 }, // under 5 games
      ] })),
      club(MIDDLE({ players: [
        { name: "Tackler", games: 12, goals: 0, passPct: 80, shotPct: 20, tacklePct: 77 },
        { name: "NoData", games: 12, goals: 0 }, // EA gave no percentages
      ] })),
    ]);
  const board = (c: ClubComparison, key: string) => c.playerBoards.find((b) => b.key === key)!;

  it("ranks players across clubs on each rate, and skips players under 5 games or without the figure", () => {
    const c = rated();
    expect(board(c, "passSuccessRate").entries.map((e) => [e.name, e.value])).toEqual([["Passer", 91], ["Tackler", 80], ["Shooter", 70]]);
    expect(board(c, "shotSuccessRate").entries.map((e) => e.name)).toEqual(["Shooter", "Passer", "Tackler"]);
    expect(board(c, "tackleSuccessRate").entries.map((e) => e.name)).toEqual(["Tackler", "Passer", "Shooter"]);
    expect(board(c, "passSuccessRate").eligible).toBe(3); // NewKid has 3 games; NoData has no rate
    expect(board(c, "passSuccessRate").total).toBe(5);
  });

  it("labels every club metric and every player board in English and Cantonese, and none for crossing or dribbling", () => {
    const keys = [...new Set(rated().playerBoards.map((b) => b.key))];
    for (const k of keys) {
      expect(BOARD_LABEL[k].en.length, k).toBeGreaterThan(3);
      expect(/[\u3400-\u9fff]/.test(BOARD_LABEL[k].zh), `${k} zh`).toBe(true);
    }
    for (const m of rated().metrics) {
      expect(METRIC_LABEL[m.key].en.length, m.key).toBeGreaterThan(3);
      expect(/[\u3400-\u9fff]/.test(METRIC_LABEL[m.key].zh), `${m.key} zh`).toBe(true);
    }
    expect(Object.keys(BOARD_LABEL).join(" ")).not.toMatch(/cross|dribbl/i);
  });
});

describe("warning wording", () => {
  const samples: ComparisonWarning[] = [
    { code: "not_enough_clubs", count: 1 }, { code: "duplicate_club", club: "A", count: 2 }, { code: "mixed_platforms", platforms: ["common-gen5", "nx"] },
    { code: "thin_games", club: "A", count: 3 }, { code: "stale_data", club: "A", days: 42 }, { code: "saved_far_apart", days: 11 },
    { code: "part_missing", club: "A", part: "memberStats" }, { code: "record_mismatch", club: "A" },
  ];

  it("has a sample for every warning code, in English and Cantonese", () => {
    expect(samples.map((s) => s.code).sort()).toEqual([...WARNING_CODES].sort());
    for (const w of samples) {
      const t = describeWarning(w);
      expect(t.en.length, w.code).toBeGreaterThan(20);
      expect(/[㐀-鿿]/.test(t.zh), `${w.code}: Cantonese text has no Chinese characters`).toBe(true);
      expect(t.en).not.toMatch(/undefined|NaN|\?\?/);
      expect(t.zh).not.toMatch(/undefined|NaN/);
    }
  });

  it("puts the numbers and names in the sentence", () => {
    expect(describeWarning({ code: "thin_games", club: "Hot Streak", count: 3 }).en).toMatch(/"Hot Streak".*3 league games/);
    expect(describeWarning({ code: "stale_data", club: "A", days: 42 }).zh).toContain("42");
    expect(describeWarning({ code: "mixed_platforms", platforms: ["common-gen5", "nx"] }).en).toContain("common-gen5, nx");
  });
});

describe("one club on its own (the user's own statistics and members)", () => {
  const one = () => compareClubs([club(STRONG({ players: [
    { name: "Ace", games: 20, goals: 30, assists: 5, rating: 8.5, motm: 6, passPct: 80, shotPct: 55, tacklePct: 40, pos: "forward" },
    { name: "Wing", games: 18, goals: 9, assists: 12, rating: 7.8, motm: 2, passPct: 88, shotPct: 30, tacklePct: 50, pos: "midfielder" },
    { name: "Rookie", games: 3, goals: 6, assists: 0, rating: 9.5, passPct: 99 },
  ] }))]);

  it("works with exactly one club: single mode, no warning about missing peers", () => {
    const c = one();
    expect(c.mode).toBe("single");
    expect(c.clubs).toHaveLength(1);
    expect(c.usableClubs).toBe(1);
    expect(c.warnings.map((w) => w.code)).not.toContain("not_enough_clubs");
  });

  it("lists EVERY member with season rates, percentages and games, most games first", () => {
    const m = one().clubs[0].members;
    expect(m.map((x) => x.name)).toEqual(["Ace", "Wing", "Rookie"]);
    expect(m[0]).toMatchObject({ name: "Ace", pos: "forward", games: 20, goals: 30, assists: 5, goalsPerGame: 1.5, assistsPerGame: 0.25, rating: 8.5, motm: 6, passPct: 80, shotPct: 55, tacklePct: 40, ranked: true });
    expect(m[1]).toMatchObject({ name: "Wing", goalsPerGame: 0.5, passPct: 88 });
  });

  it("marks a member with fewer than 5 games as not ranked, but still lists them", () => {
    const rookie = one().clubs[0].members.find((x) => x.name === "Rookie")!;
    expect(rookie).toMatchObject({ games: 3, goals: 6, goalsPerGame: 2, ranked: false });
  });

  it("ranks members WITHIN the one club on each leaderboard", () => {
    const boards = one().playerBoards;
    const pass = boards.find((b) => b.key === "passSuccessRate")!;
    expect(pass.entries.map((e) => [e.name, e.rank, e.value])).toEqual([["Wing", 1, 88], ["Ace", 2, 80]]);
    expect(boards.find((b) => b.key === "goalsPerGame")!.entries[0]).toMatchObject({ name: "Ace", rank: 1 });
  });

  it("joins career totals by name (and shows nothing when a member has no career row)", () => {
    const input = club(STRONG());
    (input.data as any).parts.memberCareerStats = { status: "ok", data: { members: [{ name: "Ace", gamesPlayed: 200, goals: 150, assists: 40, ratingAve: 8.1 }], positionCount: {} } };
    const m = compareClubs([input]).clubs[0].members;
    expect(m.find((x) => x.name === "Ace")).toMatchObject({ careerGames: 200, careerGoals: 150, careerAssists: 40, careerRating: 8.1 });
    expect(m.find((x) => x.name === "Wing")).toMatchObject({ careerGames: null, careerGoals: null });
  });

  it("still warns when the single club's own data is thin or stale", () => {
    const thin = compareClubs([club(STRONG({ record: { games: 3, wins: 2, ties: 1, losses: 0, goals: 5, goalsAgainst: 1 } }))]);
    expect(thin.warnings).toContainEqual({ code: "thin_games", club: "Strong FC", count: 3 });
  });

  it("an unreadable single club gives the 'none usable' warning, not a crash", () => {
    const c = compareClubs([club(STRONG({ record: null }))]);
    expect(c.mode).toBe("single");
    expect(c.usableClubs).toBe(0);
    expect(c.warnings.map((w) => w.code)).toContain("not_enough_clubs");
    expect(describeWarning({ code: "not_enough_clubs", count: 0 }).en).toMatch(/None of the selected clubs/);
  });

  it("two clubs where one is unreadable still warns that there is nothing to compare", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE({ record: null }))]);
    expect(c.mode).toBe("compare");
    expect(c.warnings.map((w) => w.code)).toContain("not_enough_clubs");
  });

  it("compare mode keeps member rows too, for members of different clubs", () => {
    const c = compareClubs([club(STRONG()), club(MIDDLE())]);
    expect(c.mode).toBe("compare");
    expect(c.clubs.map((x) => x.members.length)).toEqual([3, 2]);
    const goals = c.playerBoards.find((b) => b.key === "goalsPerGame")!;
    expect(new Set(goals.entries.map((e) => e.clubName))).toEqual(new Set(["Strong FC", "Middle United"]));
  });

  it("member rows are not cut in the engine (cutting is for display and the digest)", () => {
    const many = STRONG({ players: Array.from({ length: 40 }, (_, i) => ({ name: `P${String(i).padStart(2, "0")}`, games: 10, goals: i })) });
    expect(compareClubs([club(many)]).clubs[0].members).toHaveLength(40);
  });
});

describe("limits", () => {
  it("exposes the 1 to 4 club limits and the 2-club threshold for a comparison", () => {
    expect(MIN_CLUBS).toBe(1);
    expect(MIN_TO_COMPARE).toBe(2);
    expect(MAX_CLUBS).toBe(4);
    expect(MEMBERS_SINGLE).toBeGreaterThan(MEMBERS_PER_CLUB);
  });
  it("compares four clubs at once", () => {
    const four = [club(STRONG()), club(MIDDLE()), club(WEAK()), club(MIDDLE({ id: "c-4", clubId: "4", name: "Fourth", skillRating: 1750 }))];
    const c = compareClubs(four);
    expect(c.clubs).toHaveLength(4);
    expect(metric(c, "skillRating").entries.map((e) => e.rank)).toEqual([1, 3, 4, 2]);
  });
});
