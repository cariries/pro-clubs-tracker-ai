// Charts drawn by the page from numbers our code already computed. They cost NO AI tokens, and unlike model-written
// charts they cannot be wrong: every value is copied from the comparison. Pure functions return plain "specs"; the page
// draws them. A series with no data is dropped, so the page never draws an empty chart.
import { MEMBERS_SINGLE, type ClubProfile, type MemberRow, type MetricComparison } from "./club-compare";
import type { Bi } from "./i18n";
import { formString, trendMembers, type RecentMatches } from "./recent-matches";

/** Most members shown in one member chart (a longer list is unreadable on a phone). */
export const CHART_MEMBERS_MAX = 12;

export interface ChartBar {
  label: string;
  value: number;
  /** A small tag beside the value. "*" = too few games to rank; "W", "D" or "L" = the match result; a number = games played. */
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

/**
 * Recent league matches for ONE club: the result of each match, goals scored and conceded in each, and (for the members
 * with enough appearances) their rating and goal contributions in each. The category is the match number (1 = oldest of
 * the window), so reading left to right goes forward in time.
 */
export function recentMatchCharts(clubName: string, recent: RecentMatches | null, withMembers: boolean): ChartSpec[] {
  if (!recent || recent.matches.length === 0) return [];
  const n = recent.matches.length;
  const matchLabel = (i: number) => `#${i + 1}`;
  const out: ChartSpec[] = [];

  const scored = recent.matches.map((m, i) => ({ label: matchLabel(i), value: m.goalsFor, note: m.outcome }));
  const conceded = recent.matches.map((m, i) => ({ label: matchLabel(i), value: m.goalsAgainst, note: m.outcome }));
  const peak = Math.max(...scored.map((b) => b.value), ...conceded.map((b) => b.value));
  out.push({
    key: "recent-goals",
    title: { en: `${clubName}: goals in the last ${n} league matches`, zh: `${clubName}:最近 ${n} 場聯賽入球` },
    series: [
      { name: { en: "Scored", zh: "入球" }, unit: "", bars: scored },
      { name: { en: "Conceded", zh: "失球" }, unit: "", bars: conceded },
    ],
    max: niceMax([peak]),
    footnote: { en: `Form, oldest to newest: ${formString(recent)} (W win, D draw, L loss). #1 is the oldest match shown.`, zh: `戰績(由舊到新):${formString(recent).replace(/W/g, "勝").replace(/D/g, "和").replace(/L/g, "負")}。#1 係所示最舊一場。` },
  });

  if (!withMembers) return out;
  const members = trendMembers(recent);
  if (members.length === 0) return out;
  // Rating per match for the busiest members. A match the member did not play has NO bar (a gap), not a zero.
  const series: ChartSeries[] = members.map((m) => ({
    name: { en: m.name, zh: m.name },
    unit: "",
    bars: m.matches.filter((x) => finite(x.rating)).map((x) => ({ label: matchLabel(x.matchNo - 1), value: x.rating as number })),
  })).filter((s) => s.bars.length > 0);
  if (series.length > 0) {
    out.push({
      key: "recent-ratings",
      title: { en: "Match rating of the busiest members", zh: "出場最多嘅球員每場評分" },
      series,
      max: 10,
      footnote: { en: "A match with no bar means the member did not play it. Ratings are EA's, out of 10.", zh: "冇長條嘅場次代表該球員冇出場。評分由 EA 提供,滿分 10。" },
    });
  }
  const contrib: ChartSeries[] = members.map((m) => ({
    name: { en: m.name, zh: m.name },
    unit: "",
    bars: m.matches.filter((x) => finite(x.goals) || finite(x.assists)).map((x) => ({ label: matchLabel(x.matchNo - 1), value: (x.goals ?? 0) + (x.assists ?? 0) })),
  })).filter((s) => s.bars.some((b) => b.value > 0));
  if (contrib.length > 0) {
    out.push({
      key: "recent-contributions",
      title: { en: "Goals plus assists per match, busiest members", zh: "出場最多嘅球員每場入球加助攻" },
      series: contrib,
      max: niceMax(contrib.flatMap((s) => s.bars.map((b) => b.value))),
    });
  }
  return out;
}

/** The charts for a comparison, whichever mode it is in. */
export function chartsFor(c: { mode: "single" | "compare"; clubs: readonly ClubProfile[]; metrics: readonly MetricComparison[] }): ChartSpec[] {
  if (c.mode === "single") {
    const club = c.clubs[0];
    if (!club) return [];
    return [...singleClubCharts(club), ...recentMatchCharts(club.name ?? club.label, club.recent, true)];
  }
  // several clubs: one goals-per-match chart each (member lines would be unreadable side by side)
  return [...compareClubsCharts(c.clubs, c.metrics), ...c.clubs.flatMap((club) => recentMatchCharts(club.name ?? club.label, club.recent, false))];
}

/** Width of a bar as a percentage of its track, clamped to 0..100, with a small floor so a real non-zero value stays visible. */
export function barWidthPct(value: number, max: number): number {
  if (!finite(value) || !finite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(1.5, (value / max) * 100));
}

