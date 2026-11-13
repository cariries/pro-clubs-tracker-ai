// Charts drawn by the page from numbers our code already computed. They cost NO AI tokens, and unlike model-written
// charts they cannot be wrong: every value is copied from the comparison. Pure functions return plain "specs"; the page
// draws them. A series with no data is dropped, so the page never draws an empty chart.
import { MEMBERS_SINGLE, type ClubProfile, type MemberRow, type MetricComparison } from "./club-compare";
import type { Bi } from "./i18n";
import { MIN_TREND_APPEARANCES, formString, type RecentMatches } from "./recent-matches";

/**
 * Most members drawn in ONE chart. Every member with at least one game is shown (thin ones lighter); this only stops a
 * freak squad from making an unusable chart. A real Pro Clubs squad is well under it.
 */
export const CHART_MEMBERS_MAX = 40;
/** Lines drawn at full strength by default; the rest start hidden and can be switched on from the legend. */
export const LINES_ON_BY_DEFAULT = 6;

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

/** How the page draws a chart: vertical columns (one column group per member or club) or lines across the matches. */
export type ChartKind = "columns" | "lines";

export interface ChartSpec {
  key: string;
  /** Default "columns". "lines" charts are drawn over the categories in `categories`, oldest first. */
  kind: ChartKind;
  title: Bi;
  /** Lines only: the x categories in order (match #1 is the oldest). */
  categories?: string[];
  /** Labels whose values rest on too few games to be reliable; the page draws these lighter. */
  thin?: string[];
  /** Whole numbers only (goals, assists): the axis never shows a fractional tick. */
  integer?: boolean;
  /** One or more series drawn as groups of columns, or as lines. */
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

/** Members with at least one game, most games first (the table's order). Nobody with games is hidden; only an absurd squad is cut. */
function topMembers(club: ClubProfile): MemberRow[] {
  return club.members.filter((m) => (m.games ?? 0) > 0).slice(0, CHART_MEMBERS_MAX);
}

/** Labels of members with too few games for their numbers to be reliable (drawn lighter, never hidden). */
const thinLabels = (members: readonly MemberRow[]): string[] => members.filter((m) => !m.ranked).map(label);

/** One club: a vertical column chart per statistic, every member in it. */
export function singleClubCharts(club: ClubProfile): ChartSpec[] {
  const members = topMembers(club);
  const thin = thinLabels(members);
  const out: ChartSpec[] = [];

  const col = (name: Bi, pick: (m: MemberRow) => number | null, unit = "", withGames = false): ChartSeries => ({
    name,
    unit,
    bars: members.filter((m) => finite(pick(m))).map((m) => ({ label: label(m), value: pick(m) as number, note: withGames && finite(m.games) ? `${m.games}` : undefined })),
  });
  const thinNote: Bi = { en: "Lighter columns: fewer than 5 games, so the number is not reliable.", zh: "較淡嘅長條:少於 5 場,數字未必可靠。" };
  const anyThin = thin.length > 0 ? thinNote : undefined;

  // Season totals: goals and assists side by side per member.
  const goals = col({ en: "Goals", zh: "入球" }, (m) => m.goals, "", true);
  const assists = col({ en: "Assists", zh: "助攻" }, (m) => m.assists, "", true);
  if (goals.bars.some((b) => b.value > 0) || assists.bars.some((b) => b.value > 0)) {
    out.push({
      key: "members-goals-assists",
      kind: "columns",
      integer: true,
      title: { en: "Goals and assists per member (season)", zh: "每位球員入球同助攻(本季)" },
      series: [goals, assists].filter((x) => x.bars.length > 0),
      max: niceMax([...goals.bars, ...assists.bars].map((b) => b.value)),
      thin,
      footnote: anyThin,
    });
  }
  // Per-game rates: these are what compare a busy member with a new one fairly.
  const gpg = col({ en: "Goals per game", zh: "場均入球" }, (m) => m.goalsPerGame);
  const apg = col({ en: "Assists per game", zh: "場均助攻" }, (m) => m.assistsPerGame);
  if (gpg.bars.some((b) => b.value > 0) || apg.bars.some((b) => b.value > 0)) {
    out.push({
      key: "members-per-game",
      kind: "columns",
      title: { en: "Goals and assists per game (season)", zh: "場均入球同助攻(本季)" },
      series: [gpg, apg].filter((x) => x.bars.length > 0),
      max: niceMax([...gpg.bars, ...apg.bars].map((b) => b.value)),
      thin,
      footnote: anyThin,
    });
  }
  // Season average match rating, out of 10.
  const rating = col({ en: "Average rating", zh: "平均評分" }, (m) => m.rating);
  if (rating.bars.length > 0) {
    out.push({ key: "members-rating", kind: "columns", title: { en: "Average match rating per member (season)", zh: "每位球員平均賽事評分(本季)" }, series: [rating], max: 10, thin, footnote: anyThin });
  }

  const pct = (name: Bi, pick: (m: MemberRow) => number | null): ChartSeries => col(name, pick, "%");
  const rates = [pct({ en: "Pass %", zh: "傳球成功率" }, (m) => m.passPct), pct({ en: "Shot %", zh: "射門成功率" }, (m) => m.shotPct), pct({ en: "Tackle %", zh: "搶截成功率" }, (m) => m.tacklePct)].filter((s) => s.bars.length > 0);
  if (rates.length > 0) {
    out.push({
      key: "members-rates",
      kind: "columns",
      title: { en: "Pass, shot and tackle success rate per member (season)", zh: "每位球員傳球、射門、搶截成功率(本季)" },
      series: rates,
      max: 100,
      thin,
      footnote: anyThin,
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
      kind: "columns",
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
      kind: "columns",
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
  const categories = recent.matches.map((_, i) => matchLabel(i));
  const out: ChartSpec[] = [];

  const scored = recent.matches.map((m, i) => ({ label: matchLabel(i), value: m.goalsFor, note: m.outcome }));
  const conceded = recent.matches.map((m, i) => ({ label: matchLabel(i), value: m.goalsAgainst, note: m.outcome }));
  const peak = Math.max(...scored.map((b) => b.value), ...conceded.map((b) => b.value));
  out.push({
    key: "recent-goals",
    kind: "lines",
    integer: true,
    categories,
    title: { en: `${clubName}: goals in the last ${n} league matches`, zh: `${clubName}:最近 ${n} 場聯賽入球` },
    series: [
      { name: { en: "Scored", zh: "入球" }, unit: "", bars: scored },
      { name: { en: "Conceded", zh: "失球" }, unit: "", bars: conceded },
    ],
    max: niceMax([peak]),
    footnote: { en: `Form, oldest to newest: ${formString(recent)} (W win, D draw, L loss). #1 is the oldest match shown.`, zh: `戰績(由舊到新):${formString(recent).replace(/W/g, "勝").replace(/D/g, "和").replace(/L/g, "負")}。#1 係所示最舊一場。` },
  });

  if (!withMembers) return out;
  // EVERY member who played in these matches gets a line (the 6 busiest are on by default, the rest can be switched on
  // from the legend). A member with fewer than MIN_TREND_APPEARANCES is still drawn, but flagged as a thin sample.
  const members = recent.members.slice(0, CHART_MEMBERS_MAX);
  if (members.length === 0) return out;
  const thin = members.filter((m) => m.appearances < MIN_TREND_APPEARANCES).map((m) => m.name);
  const thinNote: Bi | undefined = thin.length > 0 ? { en: "Dotted names: fewer than 3 appearances in these matches, so the line says little.", zh: "有點線嘅名:呢幾場出場少於 3 次,線條參考價值有限。" } : undefined;
  const lineSeries = (pick: (x: RecentMatches["members"][number]["matches"][number]) => number | null, asInt = false): ChartSeries[] =>
    members
      .map((m): ChartSeries => ({
        name: { en: m.name, zh: m.name },
        unit: "",
        // a match the member did not play has NO point, so the line breaks there (a gap, never a zero)
        bars: m.matches.filter((x) => finite(pick(x))).map((x) => ({ label: matchLabel(x.matchNo - 1), value: asInt ? Math.round(pick(x) as number) : (pick(x) as number) })),
      }))
      .filter((x) => x.bars.length > 0);

  const rating = lineSeries((x) => x.rating);
  if (rating.length > 0) {
    out.push({
      key: "recent-ratings",
      kind: "lines",
      categories,
      title: { en: "Match rating per member, last matches", zh: "每位球員最近每場評分" },
      series: rating,
      max: 10,
      thin,
      footnote: thinNote ?? { en: "A break in a line means the member did not play that match. Ratings are EA's, out of 10.", zh: "線斷咗代表該球員冇出嗰場。評分由 EA 提供,滿分 10。" },
    });
  }
  const contrib = lineSeries((x) => (finite(x.goals) || finite(x.assists) ? (x.goals ?? 0) + (x.assists ?? 0) : null), true);
  if (contrib.some((x) => x.bars.some((b) => b.value > 0))) {
    out.push({
      key: "recent-contributions",
      kind: "lines",
      integer: true,
      categories,
      title: { en: "Goals plus assists per match, per member", zh: "每位球員每場入球加助攻" },
      series: contrib,
      max: niceMax(contrib.flatMap((x) => x.bars.map((b) => b.value))),
      thin,
      footnote: thinNote,
    });
  }
  const pass = lineSeries((x) => x.passPct);
  if (pass.length > 0) {
    out.push({
      key: "recent-pass",
      kind: "lines",
      categories,
      title: { en: "Pass completion per match, per member (%)", zh: "每位球員每場傳球成功率(%)" },
      series: pass,
      max: 100,
      thin,
      footnote: thinNote,
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

