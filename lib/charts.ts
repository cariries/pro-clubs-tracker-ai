// Charts drawn by the page from numbers our code already computed. They cost NO AI tokens, and unlike model-written
// charts they cannot be wrong: every value is copied from the comparison. Pure functions return plain "specs"; the page
// draws them. A series with no data is dropped, so the page never draws an empty chart.
import { MEMBERS_SINGLE, type ClubProfile, type MemberRow, type MetricComparison } from "./club-compare";
import type { Bi } from "./i18n";

/** Most members shown in one member chart (a longer list is unreadable on a phone). */
export const CHART_MEMBERS_MAX = 12;

export interface ChartBar {
  label: string;
  value: number;
  /** Shown beside the value, e.g. "(3 games)". Optional. */
  note?: string;
}

export interface ChartSeries {
  /** Legend and group name. */
  name: Bi;
  unit: string;
  bars: ChartBar[];
}

export interface ChartSpec {
  key: string;
  title: Bi;
  /** One or more series drawn as groups of bars. */
  series: ChartSeries[];
  /** Upper end of the scale; chosen so bars in a group compare honestly (percentages use 100). */
  max: number;
  /** A short caveat shown under the chart, e.g. members under 5 games. */
  footnote?: Bi;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

function niceMax(values: number[]): number {
  const m = Math.max(0, ...values);
  if (m <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(m));
  const n = m / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const label = (m: MemberRow) => m.name;

/** The members with the most games first (the same order the table uses), capped for readability. */
function topMembers(club: ClubProfile): MemberRow[] {
  return club.members.slice(0, Math.min(CHART_MEMBERS_MAX, MEMBERS_SINGLE));
}

/** One club: goals and assists per member, and pass / shot / tackle success percentages. */
export function singleClubCharts(club: ClubProfile): ChartSpec[] {
  const members = topMembers(club);
  const out: ChartSpec[] = [];

  const goals = members.filter((m) => finite(m.goals)).map((m) => ({ label: label(m), value: m.goals as number, note: finite(m.games) ? `${m.games}` : undefined }));
  const assists = members.filter((m) => finite(m.assists)).map((m) => ({ label: label(m), value: m.assists as number, note: finite(m.games) ? `${m.games}` : undefined }));
  if (goals.some((b) => b.value > 0) || assists.some((b) => b.value > 0)) {
    const series: ChartSeries[] = [];
    if (goals.length > 0) series.push({ name: { en: "Goals", zh: "入球" }, unit: "", bars: goals });
    if (assists.length > 0) series.push({ name: { en: "Assists", zh: "助攻" }, unit: "", bars: assists });
    out.push({
      key: "members-goals-assists",
      title: { en: "Goals and assists per member", zh: "每位球員入球同助攻" },
      series,
      max: niceMax([...goals, ...assists].map((b) => b.value)),
    });
  }

  const pct = (name: Bi, pick: (m: MemberRow) => number | null): ChartSeries => ({
    name,
    unit: "%",
    bars: members.filter((m) => finite(pick(m))).map((m) => ({ label: label(m), value: pick(m) as number })),
  });
  const rates = [pct({ en: "Pass %", zh: "傳球成功率" }, (m) => m.passPct), pct({ en: "Shot %", zh: "射門成功率" }, (m) => m.shotPct), pct({ en: "Tackle %", zh: "搶截成功率" }, (m) => m.tacklePct)].filter((s) => s.bars.length > 0);
  if (rates.length > 0) {
    out.push({
      key: "members-rates",
      title: { en: "Pass, shot and tackle success rate per member", zh: "每位球員傳球、射門、搶截成功率" },
      series: rates,
      max: 100,
      footnote: members.some((m) => !m.ranked)
        ? { en: "Members with fewer than 5 games have unreliable percentages.", zh: "少於 5 場嘅球員,百分比未必可靠。" }
        : undefined,
    });
  }
  return out;
}

/** Several clubs: win rate, and goals scored and conceded per game. A club that was not ranked still shows its value. */
export function compareClubsCharts(clubs: readonly ClubProfile[], metrics: readonly MetricComparison[]): ChartSpec[] {
  const nameOf = new Map(clubs.map((c) => [c.id, c.name ?? c.label]));
  const entries = (key: MetricComparison["key"]) => {
    const m = metrics.find((x) => x.key === key);
    if (!m) return [];
    return m.entries.filter((e) => finite(e.value)).map((e) => ({ label: nameOf.get(e.id) ?? e.id, value: e.value as number, note: e.rank === null ? "*" : undefined }));
  };
  const out: ChartSpec[] = [];
  const win = entries("winRate");
  const recent = entries("recentWinRate");
  const winSeries: ChartSeries[] = [];
  if (win.length > 0) winSeries.push({ name: { en: "Win rate", zh: "勝率" }, unit: "%", bars: win });
  if (recent.length > 0) winSeries.push({ name: { en: "Recent win rate", zh: "近期勝率" }, unit: "%", bars: recent });
  if (winSeries.length > 0) {
    out.push({
      key: "clubs-win-rate",
      title: { en: "Win rate by club", zh: "各球會勝率" },
      series: winSeries,
      max: 100,
      footnote: [...win, ...recent].some((b) => b.note === "*") ? { en: "* too few games to be ranked.", zh: "* 場數太少,不計排名。" } : undefined,
    });
  }
  const gf = entries("goalsForPerGame");
  const ga = entries("goalsAgainstPerGame");
  const goalSeries: ChartSeries[] = [];
  if (gf.length > 0) goalSeries.push({ name: { en: "Scored per game", zh: "場均入球" }, unit: "", bars: gf });
  if (ga.length > 0) goalSeries.push({ name: { en: "Conceded per game", zh: "場均失球" }, unit: "", bars: ga });
  if (goalSeries.length > 0) {
    out.push({
      key: "clubs-goals",
      title: { en: "Goals scored and conceded per game", zh: "場均入球同失球" },
      series: goalSeries,
      max: niceMax([...gf, ...ga].map((b) => b.value)),
      footnote: [...gf, ...ga].some((b) => b.note === "*") ? { en: "* too few games to be ranked.", zh: "* 場數太少,不計排名。" } : undefined,
    });
  }
  return out;
}

/** The charts for a comparison, whichever mode it is in. */
export function chartsFor(c: { mode: "single" | "compare"; clubs: readonly ClubProfile[]; metrics: readonly MetricComparison[] }): ChartSpec[] {
  if (c.mode === "single") return c.clubs[0] ? singleClubCharts(c.clubs[0]) : [];
  return compareClubsCharts(c.clubs, c.metrics);
}

/** Width of a bar as a percentage of its track, clamped to 0..100, with a small floor so a real non-zero value stays visible. */
export function barWidthPct(value: number, max: number): number {
  if (!finite(value) || !finite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(1.5, (value / max) * 100));
}

