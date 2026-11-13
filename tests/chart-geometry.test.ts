// The arithmetic behind the line charts. The page is not rendered in tests, so everything that decides WHERE a point
// goes, WHEN a line breaks and WHICH marker a series gets is a pure function tested here.
import { describe, expect, it } from "vitest";
import { DEFAULT_PLOT, LINE_COLOURS, MARKER_SHAPES, axisTicks, colourOf, lineGeometry, markerPoints, shapeOf, xAt, yAt } from "@/lib/chart-geometry";

const box = DEFAULT_PLOT;
const plotW = box.width - box.left - box.right;
const plotH = box.height - box.top - box.bottom;

describe("xAt", () => {
  it("spreads categories evenly from the left edge to the right edge of the plot", () => {
    expect(xAt(0, 5)).toBe(box.left);
    expect(xAt(4, 5)).toBe(box.width - box.right);
    expect(xAt(2, 5)).toBe(box.left + plotW / 2);
  });
  it("a single category sits in the middle, and nothing is NaN", () => {
    expect(xAt(0, 1)).toBe(box.left + plotW / 2);
    expect(Number.isNaN(xAt(0, 0))).toBe(false);
  });
});

describe("yAt", () => {
  it("puts the axis minimum at the bottom and the maximum at the top (up is bigger)", () => {
    expect(yAt(0, 0, 10)).toBe(box.top + plotH);
    expect(yAt(10, 0, 10)).toBe(box.top);
    expect(yAt(5, 0, 10)).toBe(box.top + plotH / 2);
  });
  it("a value off the axis is held at the edge instead of being drawn outside the chart", () => {
    expect(yAt(99, 0, 10)).toBe(box.top);
    expect(yAt(-5, 0, 10)).toBe(box.top + plotH);
  });
  it("a flat axis (max = min) does not divide by zero", () => {
    expect(Number.isFinite(yAt(3, 3, 3))).toBe(true);
  });
});

describe("axisTicks", () => {
  it("gives at most 6 ticks from the minimum up to the maximum", () => {
    expect(axisTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(axisTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    for (const [lo, hi] of [[0, 1], [0, 3], [0, 7], [0, 50], [0, 13]] as const) expect(axisTicks(lo, hi).length).toBeLessThanOrEqual(6);
  });
  it("a whole-number axis (goals, assists) never has a fractional tick", () => {
    for (const hi of [1, 2, 3, 4, 6, 9, 12]) for (const t of axisTicks(0, hi, true)) expect(Number.isInteger(t), `${hi}: ${t}`).toBe(true);
    expect(axisTicks(0, 1, true)).toEqual([0, 1]);
  });
  it("a decimal axis may use halves", () => {
    expect(axisTicks(0, 2)).toEqual([0, 0.5, 1, 1.5, 2]);
  });
  it("junk input gives no ticks or one, never an exception", () => {
    expect(axisTicks(Number.NaN, 5)).toEqual([]);
    expect(axisTicks(0, 0)).toEqual([0]);
    expect(axisTicks(5, 1)).toEqual([5]);
  });
});

describe("lineGeometry: points and where a line must BREAK", () => {
  const cats = ["#1", "#2", "#3", "#4", "#5"];
  const g = lineGeometry(cats, [
    { bars: [{ label: "#1", value: 8 }, { label: "#2", value: 7 }, { label: "#3", value: 9 }, { label: "#4", value: 6 }, { label: "#5", value: 7 }] }, // played everything
    { bars: [{ label: "#1", value: 7 }, { label: "#2", value: 7 }, { label: "#4", value: 8 }, { label: "#5", value: 8 }] }, // sat out #3
    { bars: [{ label: "#3", value: 5 }] }, // one appearance
    { bars: [{ label: "#1", value: 5 }, { label: "#3", value: 6 }, { label: "#5", value: 7 }] }, // every other match
  ], 0, 10);

  it("an unbroken line is ONE segment through every point", () => {
    expect(g.series[0].segments).toHaveLength(1);
    expect(g.series[0].points).toHaveLength(5);
    expect(g.series[0].segments[0].split(" ")).toHaveLength(5);
  });
  it("a member who sat a match out gets TWO segments, with no point and no line across the gap", () => {
    expect(g.series[1].points.map((p) => p.label)).toEqual(["#1", "#2", "#4", "#5"]);
    expect(g.series[1].segments).toHaveLength(2);
    expect(g.series[1].segments[0].split(" ")).toHaveLength(2);
    expect(g.series[1].segments[1].split(" ")).toHaveLength(2);
  });
  it("a single appearance is a point only: no segment (a line needs two ends)", () => {
    expect(g.series[2].points).toHaveLength(1);
    expect(g.series[2].segments).toEqual([]);
  });
  it("playing every other match gives no line at all, only points", () => {
    expect(g.series[3].points).toHaveLength(3);
    expect(g.series[3].segments).toEqual([]);
  });
  it("points use the same x for the same match in every series, and the right y for the value", () => {
    expect(g.series[0].points[2].x).toBe(g.xs[2]);
    expect(g.series[1].points[2].x).toBe(g.xs[3]);
    expect(g.series[0].points[0].y).toBe(yAt(8, 0, 10));
    expect(g.series[0].points[3].y).toBeGreaterThan(g.series[0].points[2].y); // 6 is below 9
  });
  it("the grid ticks sit at the same y as a point with that value", () => {
    const tick = g.ticks.find((t) => t.value === 8)!;
    expect(tick.y).toBe(g.series[0].points[0].y);
  });
  it("a bar for a label that is not a category, or a value that is not finite, is ignored", () => {
    const odd = lineGeometry(["#1", "#2"], [{ bars: [{ label: "#1", value: 5 }, { label: "#9", value: 5 }, { label: "#2", value: Number.NaN }] }], 0, 10);
    expect(odd.series[0].points.map((p) => p.label)).toEqual(["#1"]);
  });
  it("bars given out of order still draw left to right", () => {
    const o = lineGeometry(["#1", "#2", "#3"], [{ bars: [{ label: "#3", value: 1 }, { label: "#1", value: 2 }, { label: "#2", value: 3 }] }], 0, 5);
    expect(o.series[0].points.map((p) => p.label)).toEqual(["#1", "#2", "#3"]);
    expect(o.series[0].segments).toHaveLength(1);
  });
  it("no categories or no series gives empty geometry, not an exception", () => {
    expect(lineGeometry([], [], 0, 10).series).toEqual([]);
    expect(lineGeometry(["#1"], [], 0, 10).xs).toHaveLength(1);
  });
  it("every coordinate stays inside the plot box", () => {
    for (const s of g.series) for (const p of s.points) {
      expect(p.x).toBeGreaterThanOrEqual(box.left);
      expect(p.x).toBeLessThanOrEqual(box.width - box.right);
      expect(p.y).toBeGreaterThanOrEqual(box.top);
      expect(p.y).toBeLessThanOrEqual(box.height - box.bottom);
    }
  });
});

describe("colour and marker assignment (colour must never be the only signal)", () => {
  it("8 colours and 7 shapes, assigned by series index and wrapping around", () => {
    expect(LINE_COLOURS).toBe(8);
    expect(MARKER_SHAPES).toHaveLength(7);
    expect(colourOf(0)).toBe(0);
    expect(colourOf(8)).toBe(0);
    expect(colourOf(-1)).toBe(7);
    expect(shapeOf(0)).toBe(shapeOf(7));
  });
  it("the first 8 series have 8 DIFFERENT colours, and the first 7 have 7 DIFFERENT shapes", () => {
    expect(new Set(Array.from({ length: 8 }, (_, i) => colourOf(i))).size).toBe(8);
    expect(new Set(Array.from({ length: 7 }, (_, i) => shapeOf(i))).size).toBe(7);
  });
  it("no two of the first 40 series share BOTH a colour and a shape", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const k = `${colourOf(i)}-${shapeOf(i)}`;
      expect(seen.has(k), `series ${i}`).toBe(false);
      seen.add(k);
    }
  });
});

describe("markerPoints", () => {
  it("a circle has no polygon (it is drawn as a circle)", () => {
    expect(markerPoints("circle", 10, 10, 4)).toBeNull();
  });
  it("every other shape is a polygon centred on the point, within about its radius", () => {
    for (const shape of MARKER_SHAPES.filter((s) => s !== "circle")) {
      const pts = markerPoints(shape, 100, 50, 4)!;
      expect(pts, shape).toBeTruthy();
      const xy = pts.split(" ").map((p) => p.split(",").map(Number));
      expect(xy.length, shape).toBeGreaterThanOrEqual(3);
      const cx = xy.reduce((a, p) => a + p[0], 0) / xy.length;
      const cy = xy.reduce((a, p) => a + p[1], 0) / xy.length;
      expect(Math.abs(cx - 100), shape).toBeLessThan(2);
      expect(Math.abs(cy - 50), shape).toBeLessThan(2);
      for (const [x, y] of xy) expect(Math.hypot(x - 100, y - 50), shape).toBeLessThanOrEqual(4 * 1.5);
    }
  });
  it("the shapes really are different from each other", () => {
    const all = MARKER_SHAPES.filter((s) => s !== "circle").map((s) => markerPoints(s, 0, 0, 4));
    expect(new Set(all).size).toBe(all.length);
  });
});
