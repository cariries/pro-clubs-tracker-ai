// The radar chart: one shape per member over axes on one 0-100 scale. The pure geometry and the spec are tested here; the
// page is not rendered in tests, so the view is checked from its source.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_RADAR, RADAR_RINGS, axisAngle, radarCentre, radarLabel, radarPoint, radarPolygon, radarRadius, ringPoints } from "@/lib/chart-geometry";
import { RADAR_ON_BY_DEFAULT, radarChart } from "@/lib/charts";
import { compareClubs } from "@/lib/club-compare";
import { RADAR } from "@/lib/ui-text";
import { STRONG, club } from "./club-builders";

const C = radarCentre();
const R = radarRadius();
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

describe("radar geometry", () => {
  it("axis 0 points straight up, and the others go clockwise", () => {
    const top = radarPoint(0, 4, 1);
    expect(near(top.x, C)).toBe(true);
    expect(near(top.y, C - R)).toBe(true);
    const right = radarPoint(1, 4, 1);
    expect(near(right.x, C + R)).toBe(true);
    expect(near(right.y, C)).toBe(true);
    const bottom = radarPoint(2, 4, 1);
    expect(near(bottom.y, C + R)).toBe(true);
    const left = radarPoint(3, 4, 1);
    expect(near(left.x, C - R)).toBe(true);
  });
  it("the centre is value 0 and the rim is value 100 (a bigger value is farther from the centre)", () => {
    for (let i = 0; i < 5; i++) {
      const p0 = radarPoint(i, 5, 0);
      expect(near(p0.x, C) && near(p0.y, C)).toBe(true);
      const dist = (f: number) => Math.hypot(radarPoint(i, 5, f).x - C, radarPoint(i, 5, f).y - C);
      expect(near(dist(1), R, 0.1)).toBe(true);
      expect(dist(0.5)).toBeLessThan(dist(0.75));
      expect(dist(0.75)).toBeLessThan(dist(1));
    }
  });
  it("a value outside 0..100, NaN or Infinity is held at the ends, never drawn outside the chart", () => {
    expect(radarPoint(0, 4, 5)).toEqual(radarPoint(0, 4, 1));
    expect(radarPoint(0, 4, -3)).toEqual(radarPoint(0, 4, 0));
    expect(radarPoint(0, 4, Number.NaN)).toEqual(radarPoint(0, 4, 0));
    expect(radarPoint(0, 4, Number.POSITIVE_INFINITY)).toEqual(radarPoint(0, 4, 0));
  });
  it("every axis is the same distance from the centre at the same value (the rings are round, not lopsided)", () => {
    for (const n of [3, 5, 6, 7]) {
      const ds = Array.from({ length: n }, (_, i) => Math.hypot(radarPoint(i, n, 0.6).x - C, radarPoint(i, n, 0.6).y - C));
      for (const d of ds) expect(near(d, ds[0], 0.1)).toBe(true);
    }
  });
  it("axisAngle with no axes is a safe 0, not NaN", () => {
    expect(Number.isNaN(axisAngle(0, 0))).toBe(false);
  });
  it("rings: four of them, a quarter to the rim, one corner per axis", () => {
    expect([...RADAR_RINGS]).toEqual([0.25, 0.5, 0.75, 1]);
    expect(ringPoints(5, 1).split(" ")).toHaveLength(5);
    expect(ringPoints(0, 1)).toBe("");
  });
  it("a polygon has one corner per axis in axis order, and the values are carried through", () => {
    const poly = radarPolygon([100, 50, 0, 80]);
    expect(poly.points.map((p) => p.axis)).toEqual([0, 1, 2, 3]);
    expect(poly.points.map((p) => p.value)).toEqual([100, 50, 0, 80]);
    expect(poly.polygon.split(" ")).toHaveLength(4);
    expect(near(poly.points[0].y, C - R)).toBe(true); // 100 on the top axis reaches the rim
    expect(near(poly.points[2].x, C) && near(poly.points[2].y, C)).toBe(true); // 0 is the centre
  });
  it("fewer than 3 axes is not a shape: no polygon text", () => {
    expect(radarPolygon([50, 50]).polygon).toBe("");
    expect(radarPolygon([]).polygon).toBe("");
    expect(radarPolygon([10, 20, 30]).polygon).not.toBe("");
  });
  it("axis names sit outside the rim and are anchored away from the chart (left names end at the point, right names start)", () => {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const l = radarLabel(i, n);
      expect(Math.hypot(l.x - C, l.y - 4 - C)).toBeGreaterThan(R);
      const cos = Math.cos(axisAngle(i, n));
      if (cos > 0.2) expect(l.anchor).toBe("start");
      else if (cos < -0.2) expect(l.anchor).toBe("end");
      else expect(l.anchor).toBe("middle");
    }
  });
  it("every point of a full-strength polygon stays inside the drawing area, labels included", () => {
    for (const n of [3, 4, 5, 6, 7]) {
      for (let i = 0; i < n; i++) {
        const p = radarPoint(i, n, 1);
        expect(p.x).toBeGreaterThanOrEqual(DEFAULT_RADAR.margin - 1);
        expect(p.x).toBeLessThanOrEqual(DEFAULT_RADAR.size - DEFAULT_RADAR.margin + 1);
        expect(p.y).toBeGreaterThanOrEqual(DEFAULT_RADAR.margin - 1);
        expect(p.y).toBeLessThanOrEqual(DEFAULT_RADAR.size - DEFAULT_RADAR.margin + 1);
      }
    }
  });
});

describe("radarChart (the spec)", () => {
  const FULL = [
    { name: "Ace", games: 20, goals: 30, assists: 5, rating: 8.5, passPct: 84, shotPct: 55, tacklePct: 40 },
    { name: "Wing", games: 18, goals: 9, assists: 12, rating: 7.8, passPct: 79, shotPct: 33, tacklePct: 61 },
    { name: "Rookie", games: 3, goals: 6, assists: 0, rating: 9.5, passPct: 70, shotPct: 80, tacklePct: 20 },
  ];
  const profile = (players: unknown[]) => compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: players as never })]).clubs[0];
  const spec = radarChart(profile(FULL))!;

  it("is a radar with the six axes: pass, shot, tackle, rating, goals per game and assists per game", () => {
    expect(spec.kind).toBe("radar");
    expect(spec.key).toBe("members-radar");
    expect(spec.axes!.map((a) => a.en)).toEqual(["Pass %", "Shot %", "Tackle %", "Rating (x10)", "Goals per game (vs squad best)", "Assists per game (vs squad best)"]);
    expect(spec.max).toBe(100);
  });
  it("every series has exactly one value per axis, all inside 0 to 100", () => {
    for (const s of spec.series) {
      expect(s.bars).toHaveLength(spec.axes!.length);
      for (const b of s.bars) {
        expect(b.value).toBeGreaterThanOrEqual(0);
        expect(b.value).toBeLessThanOrEqual(100);
      }
    }
  });
  it("percentages are EA's numbers as they are, and rating is out of 10 scaled x10", () => {
    const ace = spec.series.find((s) => s.name.en === "Ace")!;
    expect(ace.bars.slice(0, 4).map((b) => b.value)).toEqual([84, 55, 40, 85]);
    expect(ace.bars[0].raw).toBe("84%");
    expect(ace.bars[3].raw).toBe("8.5");
  });
  it("goals and assists per game are measured against the squad's best (the best member is exactly 100)", () => {
    const gpg = (n: string) => spec.series.find((s) => s.name.en === n)!.bars[4].value;
    const apg = (n: string) => spec.series.find((s) => s.name.en === n)!.bars[5].value;
    // goals per game: Ace 1.5, Wing 0.5, Rookie 2 (the best) ; assists per game: Ace 0.25, Wing 0.67 (the best), Rookie 0
    expect(gpg("Rookie")).toBe(100);
    expect(gpg("Ace")).toBe(75);
    expect(gpg("Wing")).toBe(25);
    expect(apg("Wing")).toBe(100);
    expect(apg("Rookie")).toBe(0);
    expect(spec.series.find((s) => s.name.en === "Ace")!.bars[4].raw).toBe("1.5");
  });
  it("the footnote explains the relative axes and the 0-100 scale in both languages", () => {
    expect(spec.footnote!.en).toMatch(/0-100 scale/);
    expect(spec.footnote!.en).toMatch(/best in this squad/);
    expect(spec.footnote!.en).toMatch(/rating is out of 10 \(x10\)/);
    expect(/[㐀-鿿]/.test(spec.footnote!.zh)).toBe(true);
    expect(spec.footnote!.zh).toMatch(/最高/);
  });
  it("a member under 5 games is drawn, but marked thin (dotted)", () => {
    expect(spec.series.map((s) => s.name.en)).toContain("Rookie");
    expect(spec.thin).toEqual(["Rookie"]);
  });
  it("a member missing ANY stat is left off (a polygon with a hidden corner would mislead), the rest are kept", () => {
    const s = radarChart(profile([...FULL, { name: "NoShots", games: 10, goals: 2, assists: 1, rating: 7, passPct: 70, tacklePct: 50 }]))!;
    expect(s.series.map((x) => x.name.en)).toEqual(["Ace", "Wing", "Rookie"]);
  });
  it("no member with every stat gives no radar, never an empty one", () => {
    expect(radarChart(profile([{ name: "A", games: 10, goals: 2, assists: 1, rating: 7 }]))).toBeNull();
    expect(radarChart(profile([]))).toBeNull();
  });
  it("when nobody has scored or assisted, those two axes are dropped (they would all be 0) and 4 axes remain", () => {
    const s = radarChart(profile([{ name: "A", games: 10, goals: 0, assists: 0, rating: 7, passPct: 70, shotPct: 50, tacklePct: 40 }]))!;
    expect(s.axes!.map((a) => a.en)).toEqual(["Pass %", "Shot %", "Tackle %", "Rating (x10)"]);
    expect(s.series[0].bars).toHaveLength(4);
  });
  it("members with no games are not drawn", () => {
    const s = radarChart(profile([...FULL, { name: "Never", games: 0, goals: 0, assists: 0, rating: 0, passPct: 0, shotPct: 0, tacklePct: 0 }]))!;
    expect(s.series.map((x) => x.name.en)).not.toContain("Never");
  });
  it("a rating of 10 with a 100% pass rate stays exactly on the rim, not past it", () => {
    const s = radarChart(profile([{ name: "Top", games: 20, goals: 5, assists: 5, rating: 10, passPct: 100, shotPct: 100, tacklePct: 100 }]))!;
    expect(s.series[0].bars.every((b) => b.value <= 100)).toBe(true);
    expect(s.series[0].bars[3].value).toBe(100);
  });
  it("the first three start on, and a shape's order follows the table (most games first)", () => {
    expect(RADAR_ON_BY_DEFAULT).toBe(3);
    expect(spec.series.map((s) => s.name.en)).toEqual(["Ace", "Wing", "Rookie"]);
  });
  it("does not change the club it reads", () => {
    const p = profile(FULL);
    const copy = JSON.parse(JSON.stringify(p));
    radarChart(p);
    expect(p).toEqual(copy);
  });
});

describe("two gaps the first mutation round found", () => {
  it("a value of 50 is HALFWAY to the rim, 25 a quarter, 100 the rim: the polygon uses the 0-100 scale exactly", () => {
    for (const [v, f] of [[100, 1], [50, 0.5], [25, 0.25], [75, 0.75], [0, 0]] as const) {
      const p = radarPolygon([v, 10, 10]).points[0];
      const dist = Math.hypot(p.x - C, p.y - C);
      expect(near(dist, R * f, 0.1), `value ${v}`).toBe(true);
    }
  });
  it("a percentage above 100 or a negative one from EA is held to the 0-100 scale in the spec, so no shape leaves the chart", () => {
    const odd = compareClubs([club({ ...STRONG(), id: "1:common-gen5", players: [{ name: "Odd", games: 10, goals: 1, assists: 1, rating: 9, passPct: 140, shotPct: -20, tacklePct: 50 }] as never })]).clubs[0];
    const spec = radarChart(odd)!;
    for (const b of spec.series[0].bars) {
      expect(b.value).toBeGreaterThanOrEqual(0);
      expect(b.value).toBeLessThanOrEqual(100);
    }
    expect(spec.series[0].bars[0].value).toBe(100);
    expect(spec.series[0].bars[1].value).toBe(0);
    // the table still shows what EA said, so nothing is hidden by the clamp
    expect(spec.series[0].bars[0].raw).toBe("140%");
  });
});

describe("the radar view (read from source)", () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
  const view = read("components/RadarChart.tsx");
  it("is drawn from the geometry module, with no model markup", () => {
    expect(view).toMatch(/radarPolygon\(axes\.map/);
    expect(view).toMatch(/ringPoints\(n, f, box\)/);
    expect(view).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(view).not.toMatch(/from "@\/lib\/llm/);
  });
  it("each shape has its own colour AND marker shape, like the line charts", () => {
    expect(view).toMatch(/colourOf\(i\)/);
    expect(view).toMatch(/shapeOf\(i\)/);
  });
  it("the legend toggles shapes, the first three on, and a table gives the REAL numbers (not the 0-100 positions)", () => {
    expect(view).toMatch(/i < RADAR_ON_BY_DEFAULT/);
    expect(view).toMatch(/aria-pressed=\{on\[i\]\}/);
    expect(view).toMatch(/s\.bars\[k\]\?\.raw/);
    expect(view).toMatch(/<details className="lx-table">/);
  });
  it("a tooltip on each corner shows the real value", () => {
    expect(view).toMatch(/s\.bars\[p\.axis\]\?\.raw \?\? p\.value/);
  });
  it("the chart view hands radar charts to the radar component, and the page draws them for one club", () => {
    expect(read("components/ChartView.tsx")).toMatch(/c\.kind === "radar" \? \(\s*<RadarChart spec=\{c\}/);
    expect(read("lib/charts.ts")).toMatch(/const radar = radarChart\(club\);/);
  });
  it("the wording has both languages and English without Chinese", () => {
    for (const [k, v] of Object.entries(RADAR)) {
      expect(/[㐀-鿿]/.test(v.zh), k).toBe(true);
      expect(/[㐀-鿿]/.test(v.en), k).toBe(false);
    }
    expect(RADAR.tapHint.en).toMatch(/first three/);
  });
  it("shows the radar only for one club; several clubs get no radar (the shapes would be unreadable side by side)", () => {
    const src = read("lib/charts.ts");
    const compare = src.slice(src.indexOf("// several clubs:"));
    expect(compare).not.toMatch(/radarChart/);
  });
});
