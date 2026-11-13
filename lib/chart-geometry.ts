// The arithmetic behind the line charts, as pure functions so it can be tested without a browser: where each point
// sits, where a line must BREAK (a member who did not play a match has no point there), the axis ticks, and the
// marker shapes. Colour alone must never carry the meaning, so every line also has its own marker shape.

export const LINE_COLOURS = 8;
export const MARKER_SHAPES = ["circle", "square", "triangle", "diamond", "triangleDown", "plus", "cross"] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

const mod = (i: number, n: number) => ((i % n) + n) % n;
/** Colour slot 0..7 for the i-th series. Colours are theme tokens (--line-1 ... --line-8), light and dark. */
export const colourOf = (i: number): number => mod(i, LINE_COLOURS);
/** Marker shape for the i-th series. 8 colours and 7 shapes: every (colour, shape) pair is unique for 56 series. */
export const shapeOf = (i: number): MarkerShape => MARKER_SHAPES[mod(i, MARKER_SHAPES.length)];

export interface PlotBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export const DEFAULT_PLOT: PlotBox = { width: 640, height: 300, left: 46, right: 18, top: 16, bottom: 60 };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** x of category i of n (evenly spaced; a single category sits in the middle). */
export function xAt(i: number, n: number, box: PlotBox = DEFAULT_PLOT): number {
  const w = box.width - box.left - box.right;
  return r2(n <= 1 ? box.left + w / 2 : box.left + (i * w) / (n - 1));
}

/** y of a value on the axis min..max. A value outside the axis is held at the edge rather than drawn off the plot. */
export function yAt(value: number, min: number, max: number, box: PlotBox = DEFAULT_PLOT): number {
  const h = box.height - box.top - box.bottom;
  const t = max > min ? (value - min) / (max - min) : 0;
  return r2(box.top + h * (1 - Math.min(1, Math.max(0, t))));
}

/**
 * Tick values for an axis from min to max: at most 6, starting at min. `integer` axes (goals, assists) never get a
 * fractional tick such as 0.5 goals.
 */
export function axisTicks(min: number, max: number, integer = false): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return Number.isFinite(min) ? [min] : [];
  const range = max - min;
  const steps = integer ? [1, 2, 5, 10, 20, 25, 50, 100] : [0.5, 1, 2, 5, 10, 20, 25, 50, 100];
  const step = steps.find((s) => range / s <= 5) ?? Math.ceil(range / 5);
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(r2(v));
  return out;
}

export interface GeoPoint {
  x: number;
  y: number;
  /** Index of the category this point sits on. */
  index: number;
  label: string;
  value: number;
}

export interface GeoSeries {
  points: GeoPoint[];
  /** Polyline point lists. A line is broken wherever a category has no value, and a lone point makes no segment. */
  segments: string[];
}

export interface Geometry {
  xs: number[];
  ticks: Array<{ value: number; y: number }>;
  series: GeoSeries[];
}

/**
 * @param categories the x categories in order (oldest match first)
 * @param series     each series' bars; a bar whose label is not a category is ignored
 */
export function lineGeometry(categories: readonly string[], series: ReadonlyArray<{ bars: ReadonlyArray<{ label: string; value: number }> }>, min: number, max: number, integer = false, box: PlotBox = DEFAULT_PLOT): Geometry {
  const n = categories.length;
  const xs = categories.map((_, i) => xAt(i, n, box));
  const indexOf = new Map(categories.map((c, i) => [c, i]));
  return {
    xs,
    ticks: axisTicks(min, max, integer).map((value) => ({ value, y: yAt(value, min, max, box) })),
    series: series.map((s) => {
      const byIndex = new Map<number, GeoPoint>();
      for (const b of s.bars) {
        const index = indexOf.get(b.label);
        if (index === undefined || !Number.isFinite(b.value)) continue;
        byIndex.set(index, { x: xs[index], y: yAt(b.value, min, max, box), index, label: b.label, value: b.value });
      }
      const points = [...byIndex.values()].sort((a, b) => a.index - b.index);
      const segments: string[] = [];
      let run: GeoPoint[] = [];
      const flush = () => {
        if (run.length >= 2) segments.push(run.map((p) => `${p.x},${p.y}`).join(" "));
        run = [];
      };
      for (const p of points) {
        if (run.length > 0 && p.index !== run[run.length - 1].index + 1) flush(); // a missing category breaks the line
        run.push(p);
      }
      flush();
      return { points, segments };
    }),
  };
}

/** Polygon points for a marker, or null for a circle (drawn as a circle). Centred on (cx, cy), roughly 2r across. */
export function markerPoints(shape: MarkerShape, cx: number, cy: number, r: number): string | null {
  const P = (pts: Array<[number, number]>) => pts.map(([x, y]) => `${r2(cx + x)},${r2(cy + y)}`).join(" ");
  const t = r * 0.4;
  switch (shape) {
    case "circle":
      return null;
    case "square":
      return P([[-r, -r], [r, -r], [r, r], [-r, r]]);
    case "triangle":
      return P([[0, -r * 1.15], [r * 1.1, r * 0.9], [-r * 1.1, r * 0.9]]);
    case "triangleDown":
      return P([[0, r * 1.15], [r * 1.1, -r * 0.9], [-r * 1.1, -r * 0.9]]);
    case "diamond":
      return P([[0, -r * 1.25], [r * 1.25, 0], [0, r * 1.25], [-r * 1.25, 0]]);
    case "plus":
      return P([[-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t]]);
    case "cross": {
      // the plus turned 45 degrees
      const pts: Array<[number, number]> = [[-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t]];
      const c = Math.SQRT1_2;
      return P(pts.map(([x, y]) => [x * c - y * c, x * c + y * c] as [number, number]));
    }
  }
}
