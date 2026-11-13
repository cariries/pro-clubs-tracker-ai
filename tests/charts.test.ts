// Charts are drawn by the page from numbers our code computed. They must never invent, round away or misplace a value,
// must drop empty series, and must stay inside the scale. Colours are checked for contrast in both themes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHART_MEMBERS_MAX, barWidthPct, chartsFor, compareClubsCharts, singleClubCharts } from "@/lib/charts";
import { compareClubs } from "@/lib/club-compare";
import { CHARTS } from "@/lib/ui-text";
import { MIDDLE, STRONG, WEAK, club } from "./club-builders";

// the stock invented squads have no pass/shot/tackle percentages, so give this one some
const SQUAD = [
  { name: "Ace", games: 20, goals: 30, assists: 5, passPct: 84, shotPct: 55, tacklePct: 40 },
  { name: "Wing", games: 18, goals: 9, assists: 12, passPct: 79, shotPct: 33, tacklePct: 61 },
  { name: "Rookie", games: 3, goals: 6, assists: 0, passPct: 70, shotPct: 80, tacklePct: 20 },
];
const one = () => compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: SQUAD })]);
const three = () => compareClubs([club({ ...STRONG(), id: "1:common-gen5" }), club({ ...MIDDLE(), id: "2:common-gen5" }), club({ ...WEAK(), id: "3:common-gen5" })]);

describe("one club: goals, assists and the three success rates per member", () => {
  const c = one();
  const charts = singleClubCharts(c.clubs[0]);
  it("draws vertical column charts for goals and assists, per-game rates, rating and the three success rates", () => {
    expect(charts.map((x) => x.key)).toEqual(["members-goals-assists", "members-per-game", "members-rating", "members-rates"]);
    expect(charts.every((x) => x.kind === "columns")).toBe(true);
  });
  it("EVERY member with games is in every chart, not just the busiest", () => {
    const names = c.clubs[0].members.filter((m) => (m.games ?? 0) > 0).map((m) => m.name);
    expect(names.length).toBeGreaterThanOrEqual(3);
    // every column chart that has a value for a member lists that member (here every member has all the stats)
    for (const ch of charts) expect(new Set(ch.series.flatMap((x) => x.bars.map((b) => b.label)))).toEqual(new Set(names));
    const goals = charts[0].series.find((s) => s.name.en === "Goals")!;
    expect(goals.bars.map((b) => b.label)).toEqual(names);
  });
  it("a member with under 5 games is drawn but marked thin (lighter), never left out", () => {
    expect(charts[0].thin).toEqual(["Rookie"]);
    expect(charts[0].series[0].bars.map((b) => b.label)).toContain("Rookie");
    expect(charts[0].footnote?.en).toMatch(/fewer than 5 games/);
    expect(charts[0].footnote && /[\u3400-\u9fff]/.test(charts[0].footnote.zh)).toBe(true);
  });
  it("per-game and rating charts carry the table's own values", () => {
    const m = c.clubs[0].members;
    const gpg = charts.find((x) => x.key === "members-per-game")!.series.find((s) => s.name.en === "Goals per game")!;
    for (const b of gpg.bars) expect(b.value).toBe(m.find((x) => x.name === b.label)!.goalsPerGame);
    expect(charts.find((x) => x.key === "members-rating")!.max).toBe(10);
  });
  it("whole-number charts say so (so the axis never shows half a goal)", () => {
    expect(charts[0].integer).toBe(true);
    expect(charts.find((x) => x.key === "members-per-game")!.integer).toBeUndefined();
  });
  it("every bar is exactly the member's own number from the table", () => {
    const goals = charts[0].series.find((s) => s.name.en === "Goals")!;
    for (const b of goals.bars) {
      const m = c.clubs[0].members.find((x) => x.name === b.label)!;
      expect(b.value).toBe(m.goals);
    }
    const assists = charts[0].series.find((s) => s.name.en === "Assists")!;
    for (const b of assists.bars) expect(b.value).toBe(c.clubs[0].members.find((x) => x.name === b.label)!.assists);
  });
  it("percentages are EA's values, on a fixed 0 to 100 scale", () => {
    const rates = charts.find((x) => x.key === "members-rates")!;
    expect(rates.max).toBe(100);
    for (const s of rates.series) {
      expect(s.unit).toBe("%");
      for (const b of s.bars) {
        const m = c.clubs[0].members.find((x) => x.name === b.label)!;
        const want = s.name.en === "Pass %" ? m.passPct : s.name.en === "Shot %" ? m.shotPct : m.tacklePct;
        expect(b.value).toBe(want);
      }
    }
  });
  it("the goals scale covers the largest bar (nothing overflows the track)", () => {
    const biggest = Math.max(...charts[0].series.flatMap((s) => s.bars.map((b) => b.value)));
    expect(charts[0].max).toBeGreaterThanOrEqual(biggest);
  });
  it("a real squad of 30 is drawn in full, most games first; only an absurd squad is cut at CHART_MEMBERS_MAX", () => {
    const squad = Array.from({ length: 30 }, (_, i) => ({ name: `P${String(i).padStart(2, "0")}`, games: 30 - i, goals: i + 1 }));
    const big = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: squad })]);
    const labels = singleClubCharts(big.clubs[0])[0].series[0].bars.map((b) => b.label);
    expect(labels).toHaveLength(30);
    expect(labels[0]).toBe("P00");
    expect(labels[29]).toBe("P29");
    const huge = Array.from({ length: CHART_MEMBERS_MAX + 10 }, (_, i) => ({ name: `Q${i}`, games: 5, goals: 1 }));
    const h = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: huge })]);
    expect(singleClubCharts(h.clubs[0])[0].series[0].bars).toHaveLength(CHART_MEMBERS_MAX);
  });
  it("a member with ZERO games is not drawn (no numbers to show)", () => {
    const sq = [{ name: "Played", games: 5, goals: 2 }, { name: "Never", games: 0, goals: 0 }];
    const cmp = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: sq })]);
    expect(singleClubCharts(cmp.clubs[0])[0].series[0].bars.map((b) => b.label)).toEqual(["Played"]);
  });
  it("a member with no number for a stat is left out of that series, not drawn as zero", () => {
    const sq = [{ name: "Has", games: 10, goals: 4 }, { name: "None", games: 9, goals: 3 }];
    const cmp = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: sq })]);
    // the builder gives these members no pass/shot/tackle percentages
    const rates = singleClubCharts(cmp.clubs[0]).find((x) => x.key === "members-rates");
    expect(rates).toBeUndefined();
  });
  it("nothing to draw gives no charts (a club with no members)", () => {
    const cmp = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: [] })]);
    expect(singleClubCharts(cmp.clubs[0])).toEqual([]);
  });
  it("all-zero goals and assists is not drawn (an empty chart tells nothing)", () => {
    const sq = [{ name: "A", games: 10, goals: 0, assists: 0 }, { name: "B", games: 9, goals: 0, assists: 0 }];
    const cmp = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: sq })]);
    expect(singleClubCharts(cmp.clubs[0]).find((x) => x.key === "members-goals-assists")).toBeUndefined();
  });
  it("flags unreliable percentages for members under 5 games", () => {
    const sq = [{ name: "New", games: 2, goals: 1, passPct: 90, shotPct: 50, tacklePct: 60 }, { name: "Old", games: 20, goals: 5, passPct: 80, shotPct: 40, tacklePct: 70 }];
    const cmp = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: sq })]);
    const rates = singleClubCharts(cmp.clubs[0]).find((x) => x.key === "members-rates")!;
    expect(rates.footnote?.en).toMatch(/fewer than 5 games/);
    expect(rates.footnote && /[㐀-鿿]/.test(rates.footnote.zh)).toBe(true);
  });
});

describe("several clubs: win rate, and goals scored and conceded per game", () => {
  const c = three();
  const charts = compareClubsCharts(c.clubs, c.metrics);
  it("draws a win-rate chart and a goals chart, one bar per club", () => {
    expect(charts.map((x) => x.key)).toEqual(["clubs-win-rate", "clubs-goals"]);
    expect(charts[0].series[0].bars).toHaveLength(3);
  });
  it("each bar is the club's computed value, labelled with its own name", () => {
    const win = c.metrics.find((m) => m.key === "winRate")!;
    for (const b of charts[0].series[0].bars) {
      const club = c.clubs.find((x) => (x.name ?? x.label) === b.label)!;
      expect(b.value).toBe(win.entries.find((e) => e.id === club.id)!.value);
    }
    expect(charts[1].series.map((s) => s.name.en)).toEqual(["Scored per game", "Conceded per game"]);
  });
  it("win rate uses a fixed 0 to 100 scale; goals scale covers the largest bar", () => {
    expect(charts[0].max).toBe(100);
    const biggest = Math.max(...charts[1].series.flatMap((s) => s.bars.map((b) => b.value)));
    expect(charts[1].max).toBeGreaterThanOrEqual(biggest);
  });
  it("a club that was not ranked still shows its value, marked with *, and the footnote explains it", () => {
    const thin = compareClubs([club({ ...STRONG(), id: "1:common-gen5" }), club({ ...MIDDLE(), id: "2:common-gen5", record: { games: 3, wins: 3, ties: 0, losses: 0, goals: 9, goalsAgainst: 1 } })]);
    const ch = compareClubsCharts(thin.clubs, thin.metrics);
    const bars = ch[0].series[0].bars;
    expect(bars.some((b) => b.note === "*")).toBe(true);
    expect(ch[0].footnote?.en).toMatch(/too few games/);
  });
  it("a club with no record is left out rather than drawn as zero", () => {
    const broken = compareClubs([club({ ...STRONG(), id: "1:common-gen5" }), club({ ...MIDDLE(), id: "2:common-gen5", record: null })]);
    const ch = compareClubsCharts(broken.clubs, broken.metrics);
    expect(ch[0].series[0].bars.map((b) => b.label)).not.toContain("Middle United");
  });
  it("no data at all gives no charts", () => {
    expect(compareClubsCharts([], [])).toEqual([]);
  });
});

describe("gaps the first mutation round found", () => {
  it("a member with NO goals figure is absent from the goals series (not drawn as 0)", () => {
    const sq = [{ name: "Has", games: 10, goals: 4, assists: 1 }, { name: "Missing", games: 9, goals: 0, assists: 0 }];
    const cmp = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: sq })]);
    // blank out one member's goals the way an unreadable EA field would
    cmp.clubs[0].members.find((m) => m.name === "Missing")!.goals = null;
    const g = singleClubCharts(cmp.clubs[0]).find((x) => x.key === "members-goals-assists")!.series.find((x) => x.name.en === "Goals")!;
    expect(g.bars.map((b) => b.label)).toEqual(["Has"]);
  });
  it("the percentage chart's scale stays 0-100 even when every value is small (bars are comparable across charts)", () => {
    const sq = [{ name: "A", games: 10, goals: 1, passPct: 12, shotPct: 8, tacklePct: 5 }];
    const cmp = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: sq })]);
    expect(singleClubCharts(cmp.clubs[0]).find((x) => x.key === "members-rates")!.max).toBe(100);
  });
  it("Scored and Conceded are not swapped: each series carries its own metric's numbers", () => {
    const c = three();
    const gf = c.metrics.find((m) => m.key === "goalsForPerGame")!;
    const ga = c.metrics.find((m) => m.key === "goalsAgainstPerGame")!;
    const goals = compareClubsCharts(c.clubs, c.metrics).find((x) => x.key === "clubs-goals")!;
    const scored = goals.series.find((s) => s.name.en === "Scored per game")!;
    const conceded = goals.series.find((s) => s.name.en === "Conceded per game")!;
    for (const b of scored.bars) expect(b.value).toBe(gf.entries.find((e) => (c.clubs.find((x) => x.id === e.id)!.name ?? "") === b.label)!.value);
    for (const b of conceded.bars) expect(b.value).toBe(ga.entries.find((e) => (c.clubs.find((x) => x.id === e.id)!.name ?? "") === b.label)!.value);
    // and they really differ, so a swap cannot hide
    expect(scored.bars.map((b) => b.value)).not.toEqual(conceded.bars.map((b) => b.value));
  });
  it("values are NOT rounded: a decimal stays a decimal", () => {
    // 7 wins in 12 games is 58.3%, and 20 goals in 12 games is 1.67 per game, so rounding would be visible
    const rec = { games: 12, wins: 7, ties: 2, losses: 3, goals: 20, goalsAgainst: 11 };
    const c = compareClubs([club({ ...STRONG(), id: "1:common-gen5", record: rec }), club({ ...MIDDLE(), id: "2:common-gen5", record: { ...rec, wins: 5, losses: 5, goals: 17, goalsAgainst: 15 } })]);
    const charts = compareClubsCharts(c.clubs, c.metrics);
    const win = charts[0].series[0].bars.map((b) => b.value);
    const raw = c.metrics.find((m) => m.key === "winRate")!.entries.map((e) => e.value);
    expect(win).toEqual(raw);
    expect(win.some((v) => !Number.isInteger(v))).toBe(true);
    const gf = charts[1].series[0].bars.map((b) => b.value);
    expect(gf.some((v) => !Number.isInteger(v))).toBe(true);
  });
});

describe("chartsFor picks the right set for the mode", () => {
  it("one club gets member charts, several get club charts", () => {
    // the stock invented clubs carry league match SCORES but no per-member match lines, so the recent-goals chart
    // appears and the per-member match charts do not
    expect(chartsFor(one()).map((x) => x.key)).toEqual(["members-goals-assists", "members-per-game", "members-rating", "members-rates", "members-radar", "recent-goals"]);
    expect(chartsFor(three()).map((x) => x.key)).toEqual(["clubs-win-rate", "clubs-goals", "recent-goals", "recent-goals", "recent-goals"]);
  });
  it("does not mutate the comparison it reads", () => {
    const c = three();
    const copy = JSON.parse(JSON.stringify(c));
    chartsFor(c);
    expect(c).toEqual(copy);
  });
});

describe("barWidthPct", () => {
  it("is proportional, clamped, and never negative or NaN", () => {
    expect(barWidthPct(50, 100)).toBe(50);
    expect(barWidthPct(100, 100)).toBe(100);
    expect(barWidthPct(250, 100)).toBe(100);
    expect(barWidthPct(0, 100)).toBe(0);
    expect(barWidthPct(-5, 100)).toBe(0);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(barWidthPct(bad, 100)).toBe(0);
      expect(barWidthPct(5, bad)).toBe(0);
    }
    expect(barWidthPct(5, 0)).toBe(0);
  });
  it("a tiny real value stays visible", () => {
    expect(barWidthPct(0.01, 100)).toBeGreaterThanOrEqual(1.5);
  });
});

describe("wording and wiring", () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
  it("every chart string has both languages; the note says no AI is used", () => {
    for (const [k, v] of Object.entries(CHARTS)) {
      expect(v.en.length, k).toBeGreaterThan(0);
      expect(/[㐀-鿿]/.test(v.zh), k).toBe(true);
      expect(/[㐀-鿿]/.test(v.en), k).toBe(false);
    }
    expect(CHARTS.note.en).toMatch(/no AI/i);
  });
  it("the Ask AI page and the club page both draw the charts", () => {
    expect(read("app/analysis/AnalysisClient.tsx")).toMatch(/<ChartView charts=\{chartsFor\(c\)\}/);
    expect(read("app/club/[clubId]/page.tsx")).toMatch(/<ChartView charts=\{chartsFor\(\{ mode: "single", clubs: \[p\], metrics: \[\] \}\)\}/);
  });
  it("charts use no model output: the chart module imports nothing from the LLM code", () => {
    expect(read("lib/charts.ts")).not.toMatch(/from "\.\/llm|from "@\/lib\/llm/);
    expect(read("components/ChartView.tsx")).not.toMatch(/dangerouslySetInnerHTML|<svg|innerHTML/);
  });
  it("chart widths come only from computed values", () => {
    expect(read("components/ChartView.tsx")).toMatch(/columnHeightPct\(bar\.value, c\.max\)/);
  });
});

import { recentMatchCharts } from "@/lib/charts";
import { readRecentMatches } from "@/lib/recent-matches";
import type { ClubProfile } from "@/lib/club-compare";

describe("recent league matches: club and member charts", () => {
  const ME = "100";
  const mk = (i: number, gf: number, ga: number, players: Array<Record<string, unknown>>) => ({
    matchId: `m${i}`,
    timestamp: 1_800_000_000 + i * 3600,
    clubs: { [ME]: { goals: gf, goalsAgainst: ga, name: "Mine" }, "200": { goals: ga, goalsAgainst: gf, name: `Opp${i}` } },
    players: { [ME]: players, "200": [] },
  });
  const p = (name: string, goals: number, assists: number, rating: number) => ({ name, goals, assists, rating, passesMade: 8, passAttempts: 10 });
  const matches = [
    mk(1, 2, 0, [p("Ace", 1, 0, 8), p("Wing", 0, 1, 7)]),
    mk(2, 0, 1, [p("Ace", 0, 0, 6)]),
    mk(3, 3, 3, [p("Ace", 2, 1, 9), p("Wing", 1, 0, 7.5), p("Rookie", 0, 0, 6)]),
    mk(4, 1, 0, [p("Ace", 1, 0, 8), p("Wing", 0, 0, 7)]),
  ];
  const recent = readRecentMatches({ parts: { leagueMatches: { status: "ok", data: matches } } }, ME);

  it("draws goals scored and conceded for every match, oldest first, tagged with the result", () => {
    const g = recentMatchCharts("Mine", recent, false)[0];
    expect(g.key).toBe("recent-goals");
    expect(g.series[0].bars.map((b) => b.label)).toEqual(["#1", "#2", "#3", "#4"]);
    expect(g.series[0].bars.map((b) => b.value)).toEqual([2, 0, 3, 1]);
    expect(g.series[1].bars.map((b) => b.value)).toEqual([0, 1, 3, 0]);
    expect(g.series[0].bars.map((b) => b.note)).toEqual(["W", "L", "D", "W"]);
  });
  it("the title and footnote say how many matches, the form oldest to newest, in both languages", () => {
    const g = recentMatchCharts("Mine", recent, false)[0];
    expect(g.title.en).toBe("Mine: goals in the last 4 league matches");
    expect(g.title.zh).toBe("Mine:最近 4 場聯賽入球");
    expect(g.footnote?.en).toContain("WLDW");
    expect(g.footnote?.zh).toContain("勝負和勝");
  });
  it("the goals scale covers the biggest bar", () => {
    const g = recentMatchCharts("Mine", recent, false)[0];
    expect(g.max).toBeGreaterThanOrEqual(3);
  });
  it("member charts: rating per match for members with enough appearances, a skipped match is a GAP not a zero", () => {
    const charts = recentMatchCharts("Mine", recent, true);
    const rating = charts.find((c) => c.key === "recent-ratings")!;
    expect(rating.max).toBe(10);
    expect(rating.kind).toBe("lines");
    expect(rating.categories).toEqual(["#1", "#2", "#3", "#4"]);
    // EVERY member who played gets a line, including Rookie (one appearance), who is flagged as a thin sample
    expect(rating.series.map((s) => s.name.en)).toEqual(["Ace", "Wing", "Rookie"]);
    expect(rating.thin).toEqual(["Rookie"]);
    const wing = rating.series.find((s) => s.name.en === "Wing")!;
    expect(wing.bars.map((b) => b.label)).toEqual(["#1", "#3", "#4"]); // sat out #2
    expect(wing.bars.map((b) => b.value)).toEqual([7, 7.5, 7]);
    const ace = rating.series.find((s) => s.name.en === "Ace")!;
    expect(ace.bars.map((b) => b.value)).toEqual([8, 6, 9, 8]);
  });
  it("a match the member played but EA gave NO rating for is left out of the rating chart, not drawn as a rating of 0", () => {
    const rows = [1, 2, 3, 4].map((i) => mk(i, 1, 0, [i === 2 ? { name: "Ace", goals: 1, assists: 0, rating: null, passesMade: 5, passAttempts: 6 } : p("Ace", 1, 0, 7 + i / 10)]));
    const r = readRecentMatches({ parts: { leagueMatches: { status: "ok", data: rows } } }, ME);
    const rating = recentMatchCharts("Mine", r, true).find((c) => c.key === "recent-ratings")!;
    expect(rating.series[0].bars.map((b) => b.label)).toEqual(["#1", "#3", "#4"]);
    expect(rating.series[0].bars.every((b) => b.value > 0)).toBe(true);
  });
  it("member charts: goals plus assists per match", () => {
    const c = recentMatchCharts("Mine", recent, true).find((x) => x.key === "recent-contributions")!;
    const ace = c.series.find((s) => s.name.en === "Ace")!;
    expect(ace.bars.map((b) => b.value)).toEqual([1, 0, 3, 1]);
  });
  it("several clubs get the goals chart only: no member lines (they would be unreadable side by side)", () => {
    expect(recentMatchCharts("Mine", recent, false).map((x) => x.key)).toEqual(["recent-goals"]);
  });
  it("no matches loaded (null) or none readable gives no charts, never an empty one", () => {
    expect(recentMatchCharts("Mine", null, true)).toEqual([]);
  });
  it("a club whose members each played under 3 matches still draws their lines, all flagged thin", () => {
    const few = readRecentMatches({ parts: { leagueMatches: { status: "ok", data: [mk(1, 1, 0, [p("A", 1, 0, 8)]), mk(2, 1, 0, [p("A", 0, 0, 7)])] } } }, ME);
    const keys = recentMatchCharts("Mine", few, true).map((x) => x.key);
    expect(keys).toEqual(["recent-goals", "recent-ratings", "recent-contributions", "recent-pass"]);
    expect(recentMatchCharts("Mine", few, true).find((x) => x.key === "recent-ratings")!.thin).toEqual(["A"]);
  });
  it("a member whose goals and assists are all zero gives no contributions chart (an empty chart tells nothing)", () => {
    const flat = readRecentMatches({ parts: { leagueMatches: { status: "ok", data: [1, 2, 3].map((i) => mk(i, 1, 0, [p("Z", 0, 0, 7)])) } } }, ME);
    expect(recentMatchCharts("Mine", flat, true).map((x) => x.key)).toEqual(["recent-goals", "recent-ratings", "recent-pass"]);
  });
  it("chartsFor includes the member match charts for one club and one goals chart PER club for several", () => {
    const profile = { name: "Mine", label: "x", id: "100:nx", recent, members: [] } as unknown as ClubProfile;
    const keys = chartsFor({ mode: "single", clubs: [profile], metrics: [] }).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["recent-goals", "recent-ratings", "recent-contributions"]));
    const many = chartsFor({ mode: "compare", clubs: [profile, { ...profile, id: "200:nx", name: "Other" }], metrics: [] }).map((x) => x.key);
    expect(many.filter((k) => k === "recent-goals")).toHaveLength(2);
    expect(many).not.toContain("recent-ratings");
  });
});

describe("every line chart is fully specified (a missing field draws an empty or wrong chart)", () => {
  const ME = "100";
  const mk = (i: number, gf: number, ga: number, players: Array<Record<string, unknown>>) => ({
    matchId: `m${i}`, timestamp: 1_800_000_000 + i * 3600,
    clubs: { [ME]: { goals: gf, goalsAgainst: ga, name: "Mine" }, "200": { goals: ga, goalsAgainst: gf, name: "Opp" } },
    players: { [ME]: players, "200": [] },
  });
  const p = (name: string, goals: number, assists: number, rating: number) => ({ name, goals, assists, rating, passesMade: 8, passAttempts: 10 });
  const rows = [1, 2, 3, 4].map((i) => mk(i, 1, 0, [p("Ace", i % 2, 1, 7), p("Wing", 0, 1, 6.5)]));
  const recent = readRecentMatches({ parts: { leagueMatches: { status: "ok", data: rows } } }, ME);
  const charts = recentMatchCharts("Mine", recent, true);
  it("all four line charts exist", () => {
    expect(charts.map((c) => c.key)).toEqual(["recent-goals", "recent-ratings", "recent-contributions", "recent-pass"]);
    expect(charts.every((c) => c.kind === "lines")).toBe(true);
  });
  it("each one lists the match categories in order, #1 oldest, and every point's label is one of them", () => {
    for (const c of charts) {
      expect(c.categories, c.key).toEqual(["#1", "#2", "#3", "#4"]);
      for (const s of c.series) for (const b of s.bars) expect(c.categories, `${c.key} ${b.label}`).toContain(b.label);
    }
  });
  it("whole-number charts (goals, goals plus assists) are flagged so the axis never shows half a goal; rating and pass are not", () => {
    const flag = Object.fromEntries(charts.map((c) => [c.key, c.integer === true]));
    expect(flag).toEqual({ "recent-goals": true, "recent-ratings": false, "recent-contributions": true, "recent-pass": false });
  });
  it("the scales: goals fit the biggest bar, rating is out of 10, pass completion is out of 100", () => {
    const by = Object.fromEntries(charts.map((c) => [c.key, c.max]));
    expect(by["recent-ratings"]).toBe(10);
    expect(by["recent-pass"]).toBe(100);
    expect(by["recent-goals"]).toBeGreaterThanOrEqual(1);
    expect(by["recent-contributions"]).toBeGreaterThanOrEqual(2); // Ace has 1 goal + 1 assist in some matches
  });
  it("pass completion points are made / attempted, as a percentage", () => {
    const pass = charts.find((c) => c.key === "recent-pass")!;
    for (const s of pass.series) for (const b of s.bars) expect(b.value).toBe(80);
  });
  it("goals plus assists are whole numbers", () => {
    const c = charts.find((x) => x.key === "recent-contributions")!;
    for (const s of c.series) for (const b of s.bars) expect(Number.isInteger(b.value)).toBe(true);
    expect(c.series.find((s) => s.name.en === "Ace")!.bars.map((b) => b.value)).toEqual([2, 1, 2, 1]); // goals i%2 (1,0,1,0) plus 1 assist each
  });
  it("the first six lines are on by default, and the rest wait to be switched on", async () => {
    const { LINES_ON_BY_DEFAULT } = await import("@/lib/charts");
    expect(LINES_ON_BY_DEFAULT).toBe(6);
  });
});

describe("the page draws what the code says (read from source)", () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
  const view = read("components/ChartView.tsx");
  const line = read("components/LineChart.tsx");
  it("a lines chart goes to the SVG line component and a columns chart to the column view", () => {
    expect(view).toMatch(/c\.kind === "lines" \? \(\s*<LineChart spec=\{c\}/);
    expect(view).toMatch(/<Columns c=\{c\}/);
  });
  it("the line chart is drawn from the geometry module, never from raw values, and never from model output", () => {
    expect(line).toMatch(/lineGeometry\(categories, spec\.series, 0, spec\.max, spec\.integer === true\)/);
    expect(line).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(line).not.toMatch(/from "@\/lib\/llm/);
  });
  it("every line has a marker shape as well as a colour (colour is not the only signal)", () => {
    expect(line).toMatch(/shapeOf\(i\)/);
    expect(line).toMatch(/markerPoints\(/);
  });
  it("the legend toggles lines, starts with the busiest on, and offers show-all and busiest-only", () => {
    expect(line).toMatch(/i < LINES_ON_BY_DEFAULT/);
    expect(line).toMatch(/aria-pressed=\{on\[i\]\}/);
    expect(line).toMatch(/setOn\(spec\.series\.map\(\(\) => true\)\)/);
  });
  it("the numbers are also given as a table (for screen readers, and for exact values)", () => {
    expect(line).toMatch(/<details className="lx-table">/);
    expect(line).toMatch(/<table>/);
  });
  it("a thin sample is shown differently: dotted line and italic legend name", () => {
    expect(line).toMatch(/isThin \? "thin"/);
    expect(read("app/globals.css")).toMatch(/\.linechart \.thin \.ln \{ stroke-dasharray/);
    expect(view).toMatch(/cgroup \$\{thin\.has\(label\) \? "thin" : ""\}/);
    expect(read("app/globals.css")).toMatch(/\.cols \.cgroup\.thin \.cfill \{ opacity/);
  });
  it("column charts scroll sideways on a phone instead of squashing every member into the width", () => {
    expect(read("app/globals.css")).toMatch(/\.cols \{[^}]*overflow-x: auto/);
    expect(read("app/globals.css")).toMatch(/\.lines-wrap \{ overflow-x: auto/);
  });
});

describe("the AI is told about the radar too", () => {
  it("the radar's title is in chartsShown for one club, the same list the page draws", async () => {
    const { buildDigest } = await import("@/lib/llm/prompt");
    const squad = [
      { name: "Ace", games: 20, goals: 30, assists: 5, rating: 8.5, passPct: 84, shotPct: 55, tacklePct: 40 },
      { name: "Wing", games: 18, goals: 9, assists: 12, rating: 7.8, passPct: 79, shotPct: 33, tacklePct: 61 },
    ];
    const c = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: squad })]);
    const dg = buildDigest(c) as { chartsShown: string[] };
    expect(dg.chartsShown).toEqual(chartsFor(c).map((x) => x.title.en));
    expect(dg.chartsShown).toContain("Member profile radar (season)");
  });
});

describe("the chart view shows results as words", () => {
  it("W, D and L become win, draw and loss in the reader's language", () => {
    expect(CHARTS.W.en).toBe("win");
    expect(CHARTS.D.zh).toBe("和");
    expect(CHARTS.L.zh).toBe("負");
  });
});

import { buildDigest, buildPrompt } from "@/lib/llm/prompt";

describe("the AI sees the recent matches and the chart titles", () => {
  const ME = "100";
  const mk = (i: number, gf: number, ga: number, players: Array<Record<string, unknown>>) => ({
    matchId: `m${i}`, timestamp: 1_800_000_000 + i * 3600,
    clubs: { [ME]: { goals: gf, goalsAgainst: ga, name: "Mine" }, "200": { goals: ga, goalsAgainst: gf, name: "Opp" } },
    players: { [ME]: players, "200": [] },
  });
  const p = (name: string, goals: number, assists: number, rating: number) => ({ name, goals, assists, rating, passesMade: 8, passAttempts: 10 });
  const ms = [1, 2, 3, 4, 5].map((i) => mk(i, i % 2, 0, [p("Ace", i % 2, 0, 7 + i / 10), p("Wing", 0, 1, 6.5)]));
  const base = club({ ...STRONG(), id: "100:common-gen5", clubId: "100" });
  const withMatches = () => {
    const d = JSON.parse(JSON.stringify(base.data));
    d.parts.leagueMatches = { status: "ok", data: ms };
    return compareClubs([{ ...base, data: d }]);
  };

  it("sends each club's recent results oldest first, with the form and per-member match lines", () => {
    const dg = buildDigest(withMatches()) as any;
    const r = dg.clubs[0].recentMatches;
    expect(r.matches).toBe(5);
    // matches 1..5 score i%2 to 0: odd i wins 1-0, even i is a 0-0 draw
    expect(r.formOldestFirst).toBe("WDWDW");
    expect(r.results[0]).toMatch(/^#1 [WDL] \d+-\d+$/);
    const ace = r.members.find((m: any) => m.name === "Ace");
    expect(ace.perMatch).toHaveLength(5);
    expect(ace.perMatch[0]).toMatch(/^#1: \dg \da r7\.\d$/);
  });
  it("a member who sat a match out is simply missing from that match line", () => {
    const rows = [mk(1, 1, 0, [p("Ace", 1, 0, 8), p("Wing", 0, 0, 7)]), mk(2, 1, 0, [p("Ace", 0, 0, 7)]), mk(3, 1, 0, [p("Ace", 0, 0, 7), p("Wing", 0, 0, 7)]), mk(4, 1, 0, [p("Ace", 0, 0, 7), p("Wing", 0, 0, 7)])];
    const d = JSON.parse(JSON.stringify(base.data)); d.parts.leagueMatches = { status: "ok", data: rows };
    const dg = buildDigest(compareClubs([{ ...base, data: d }])) as any;
    const wing = dg.clubs[0].recentMatches.members.find((m: any) => m.name === "Wing");
    expect(wing.perMatch.map((x: string) => x.split(":")[0])).toEqual(["#1", "#3", "#4"]);
  });
  it("the form letters are in the order the label says: oldest first, matching the result lines", () => {
    // build a club whose first (oldest) match is a LOSS and whose newest is a WIN, so a reversed string cannot pass
    const rows = [mk(1, 0, 2, [p("Ace", 0, 0, 6)]), mk(2, 1, 1, [p("Ace", 0, 0, 7)]), mk(3, 3, 0, [p("Ace", 2, 0, 9)])];
    const d = JSON.parse(JSON.stringify(base.data)); d.parts.leagueMatches = { status: "ok", data: rows };
    const dg = buildDigest(compareClubs([{ ...base, data: d }])) as any;
    const r = dg.clubs[0].recentMatches;
    expect(r.formOldestFirst).toBe("LDW");
    expect(r.results).toEqual(["#1 L 0-2", "#2 D 1-1", "#3 W 3-0"]);
    expect(r.formOldestFirst.split("")).toEqual(r.results.map((x: string) => x.split(" ")[1]));
    // and the older recentForm block is the OPPOSITE order, so the two are never confused
    expect(dg.clubs[0].recentForm.newestFirst).toBe("WDL");
  });
  it("a member with fewer than 3 appearances is NOT in the digest's member list (a trend from 1 or 2 games is noise)", () => {
    const rows = [mk(1, 1, 0, [p("Busy", 1, 0, 8), p("Once", 0, 0, 9)]), mk(2, 1, 0, [p("Busy", 0, 0, 7)]), mk(3, 1, 0, [p("Busy", 0, 1, 8)])];
    const d = JSON.parse(JSON.stringify(base.data)); d.parts.leagueMatches = { status: "ok", data: rows };
    const names = ((buildDigest(compareClubs([{ ...base, data: d }])) as any).clubs[0].recentMatches.members as any[]).map((m) => m.name);
    expect(names).toEqual(["Busy"]);
  });
  it("the trimmed digest (used when the full one is too big) keeps the results but drops the per-member lines", () => {
    const dg = buildDigest(withMatches(), 3, 6) as any;
    expect(dg.clubs[0].recentMatches.results).toHaveLength(5);
    expect(dg.clubs[0].recentMatches.members).toBeUndefined();
  });
  it("a club with no matches loaded has recentMatches null (the model is not told anything invented)", () => {
    const dg = buildDigest(compareClubs([club({ ...STRONG(), id: "1:common-gen5" })])) as any;
    // the stock club carries match SCORES, so build one with the matches part removed
    const d = JSON.parse(JSON.stringify(club({ ...STRONG(), id: "1:common-gen5" }).data)); delete d.parts.leagueMatches;
    const none = buildDigest(compareClubs([{ ...club({ ...STRONG(), id: "1:common-gen5" }), data: d }])) as any;
    expect(none.clubs[0].recentMatches).toBeNull();
    expect(dg.clubs[0].recentMatches).not.toBeNull();
  });
  it("lists the titles of the charts the page draws, the same ones chartsFor returns", () => {
    const c = withMatches();
    const dg = buildDigest(c) as any;
    expect(dg.chartsShown).toEqual(chartsFor(c).map((x) => x.title.en));
    expect(dg.chartsShown.some((t: string) => /last 5 league matches/.test(t))).toBe(true);
  });
  it("the digest stays small: five matches of two busy members add well under 2 KB", () => {
    const without = JSON.stringify((buildDigest(compareClubs([club({ ...STRONG(), id: "100:common-gen5", clubId: "100" })])) as any).clubs[0].recentMatches);
    const withM = JSON.stringify((buildDigest(withMatches()) as any).clubs[0].recentMatches);
    expect(withM.length).toBeLessThan(2000);
    expect(without).toBeDefined();
  });
  it("it all reaches the prompt as numbers only, and the prompt tells the model how to use it", () => {
    const pr = buildPrompt(buildDigest(withMatches()), "how is the form?", "en");
    expect(pr.user).toContain("formOldestFirst");
    expect(pr.user).toContain("chartsShown");
    expect(pr.system).toMatch(/recentMatches/);
  });
});
