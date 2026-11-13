"use client";

import { useState } from "react";
import { DEFAULT_RADAR, RADAR_RINGS, colourOf, markerPoints, radarLabel, radarPoint, radarPolygon, ringPoints, shapeOf } from "@/lib/chart-geometry";
import { RADAR_ON_BY_DEFAULT, type ChartSpec } from "@/lib/charts";
import { pick, type Lang } from "@/lib/i18n";
import { RADAR } from "@/lib/ui-text";

// A radar (spider) chart drawn as SVG by OUR code from computed numbers (never a model's SVG). Each member's shape has its
// own colour AND its own marker shape. The first three members start on; tap a name in the legend to show or hide any.
// A table of the REAL numbers (not the 0-100 positions) sits underneath for screen readers and exact values.
export default function RadarChart({ spec, lang }: { spec: ChartSpec; lang: Lang }) {
  const axes = spec.axes ?? [];
  const n = axes.length;
  const [on, setOn] = useState<boolean[]>(() => spec.series.map((_, i) => i < RADAR_ON_BY_DEFAULT));
  const box = DEFAULT_RADAR;
  const thin = new Set(spec.thin ?? []);
  const nameOf = (i: number) => pick(spec.series[i].name, lang);
  const toggle = (i: number) => setOn((cur) => cur.map((v, k) => (k === i ? !v : v)));

  return (
    <div>
      <div className="lines-wrap">
        <svg className="radar" viewBox={`0 0 ${box.size} ${box.size}`} role="img" aria-label={`${pick(RADAR.aria, lang)}: ${pick(spec.title, lang)}`} preserveAspectRatio="xMidYMid meet">
          {RADAR_RINGS.map((f) => (
            <polygon key={f} className="ring" points={ringPoints(n, f, box)} />
          ))}
          {axes.map((_, i) => {
            const end = radarPoint(i, n, 1, box);
            return <line key={i} className="spoke" x1={box.size / 2} y1={box.size / 2} x2={end.x} y2={end.y} />;
          })}
          {axes.map((a, i) => {
            const l = radarLabel(i, n, box);
            return (
              <text key={i} x={l.x} y={l.y} textAnchor={l.anchor}>
                {pick(a, lang)}
              </text>
            );
          })}
          {spec.series.map((s, i) => {
            const slot = colourOf(i);
            const shape = shapeOf(i);
            const poly = radarPolygon(axes.map((_, k) => s.bars[k]?.value ?? 0), box);
            return (
              <g key={i} className={`${on[i] ? "" : "off"} ${thin.has(spec.series[i].name.en) ? "thin" : ""}`}>
                <polygon className={`rshape l${slot}`} points={poly.polygon} />
                {poly.points.map((p) => {
                  const m = markerPoints(shape, p.x, p.y, 4);
                  return m === null ? (
                    <circle key={p.axis} className={`mk l${slot}`} cx={p.x} cy={p.y} r={4}>
                      <title>{`${nameOf(i)} · ${pick(axes[p.axis], lang)}: ${s.bars[p.axis]?.raw ?? p.value}`}</title>
                    </circle>
                  ) : (
                    <polygon key={p.axis} className={`mk l${slot}`} points={m}>
                      <title>{`${nameOf(i)} · ${pick(axes[p.axis], lang)}: ${s.bars[p.axis]?.raw ?? p.value}`}</title>
                    </polygon>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="lx-legend">
        {spec.series.map((_, i) => {
          const poly = markerPoints(shapeOf(i), 7, 7, 4.5);
          return (
            <li key={i}>
              <button type="button" className={thin.has(spec.series[i].name.en) ? "thin" : ""} aria-pressed={on[i]} onClick={() => toggle(i)}>
                <svg viewBox="0 0 14 14" aria-hidden>
                  {poly === null ? <circle className={`l${colourOf(i)}`} cx={7} cy={7} r={4.5} /> : <polygon className={`l${colourOf(i)}`} points={poly} />}
                </svg>
                {nameOf(i)}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted">
        <small>{pick(RADAR.tapHint, lang)}</small>
      </p>
      <details className="lx-table">
        <summary>{pick(RADAR.tableTitle, lang)}</summary>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{pick(RADAR.stat, lang)}</th>
                {spec.series.map((_, i) => (
                  <th key={i}>{nameOf(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {axes.map((a, k) => (
                <tr key={k}>
                  <td>{pick(a, lang)}</td>
                  {spec.series.map((s, i) => (
                    <td key={i}>{s.bars[k]?.raw ?? "–"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
