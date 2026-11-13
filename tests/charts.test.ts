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
  it("draws a goals-and-assists chart and a rates chart", () => {
    expect(charts.map((x) => x.key)).toEqual(["members-goals-assists", "members-rates"]);
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
    expect(charts[1].max).toBe(100);
    for (const s of charts[1].series) {
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
  it("shows at most CHART_MEMBERS_MAX members, the ones with the most games first", () => {
    const squad = Array.from({ length: 30 }, (_, i) => ({ name: `P${String(i).padStart(2, "0")}`, games: 30 - i, goals: i + 1 }));
    const big = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: squad })]);
    const ch = singleClubCharts(big.clubs[0]);
    const labels = ch[0].series[0].bars.map((b) => b.label);
    expect(labels).toHaveLength(CHART_MEMBERS_MAX);
    expect(labels[0]).toBe("P00");
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
    expect(chartsFor(one()).map((x) => x.key)).toEqual(["members-goals-assists", "members-rates"]);
    expect(chartsFor(three()).map((x) => x.key)).toEqual(["clubs-win-rate", "clubs-goals"]);
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
    expect(read("app/club/[clubId]/page.tsx")).toMatch(/<ChartView charts=\{singleClubCharts\(p\)\}/);
  });
  it("charts use no model output: the chart module imports nothing from the LLM code", () => {
    expect(read("lib/charts.ts")).not.toMatch(/from "\.\/llm|from "@\/lib\/llm/);
    expect(read("components/ChartView.tsx")).not.toMatch(/dangerouslySetInnerHTML|<svg|innerHTML/);
  });
  it("chart widths come only from computed values", () => {
    expect(read("components/ChartView.tsx")).toMatch(/barWidthPct\(bar\.value, c\.max\)/);
  });
});
