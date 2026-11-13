"use client";

import { useState } from "react";
import { DEFAULT_PLOT, colourOf, lineGeometry, markerPoints, shapeOf } from "@/lib/chart-geometry";
import { LINES_ON_BY_DEFAULT, type ChartSpec } from "@/lib/charts";
import { fill, pick, type Lang } from "@/lib/i18n";
import { LINES } from "@/lib/ui-text";

// A line chart drawn as SVG by OUR code from computed numbers (never a model's SVG). Each line has its own colour AND its
// own marker shape, so colour is never the only signal. A match the member did not play has no point, so the line breaks
// there. The 6 busiest lines start on; the legend toggles any of them. A table of the same numbers sits under the chart
// for screen readers and for anyone who wants the exact values.
export default function LineChart({ spec, lang }: { spec: ChartSpec; lang: Lang }) {
  const categories = spec.categories ?? [];
  const [on, setOn] = useState<boolean[]>(() => spec.series.map((_, i) => i < LINES_ON_BY_DEFAULT));
  const geo = lineGeometry(categories, spec.series, 0, spec.max, spec.integer === true);
  const box = DEFAULT_PLOT;
  const thin = new Set(spec.thin ?? []);
  const nameOf = (i: number) => pick(spec.series[i].name, lang);
  const hidden = on.filter((v) => !v).length;
  const toggle = (i: number) => setOn((cur) => cur.map((v, k) => (k === i ? !v : v)));

  return (
    <div>
      <div className="lines-wrap">
        <svg className="linechart" viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label={`${pick(LINES.aria, lang)}: ${pick(spec.title, lang)}`} preserveAspectRatio="xMidYMid meet">
          {geo.ticks.map((t) => (
            <g key={t.value}>
              <line className="grid" x1={box.left} x2={box.width - box.right} y1={t.y} y2={t.y} />
              <text x={box.left - 8} y={t.y + 4} textAnchor="end">
                {t.value}
              </text>
            </g>
          ))}
          <line className="axis" x1={box.left} x2={box.left} y1={box.top} y2={box.height - box.bottom} />
          <line className="axis" x1={box.left} x2={box.width - box.right} y1={box.height - box.bottom} y2={box.height - box.bottom} />
          {categories.map((c, i) => (
            <text key={c} x={geo.xs[i]} y={box.height - box.bottom + 18} textAnchor="middle">
              {c}
            </text>
          ))}
          {geo.series.map((g, i) => {
            const slot = colourOf(i);
            const shape = shapeOf(i);
            const isThin = thin.has(spec.series[i].name.en);
            return (
              <g key={i} className={`${on[i] ? "" : "off"} ${isThin ? "thin" : ""}`}>
                {g.segments.map((pts, k) => (
                  <polyline key={k} className={`ln l${slot}`} points={pts} />
                ))}
                {g.points.map((p) => {
                  const poly = markerPoints(shape, p.x, p.y, 4.5);
                  return poly === null ? (
                    <circle key={p.index} className={`mk l${slot}`} cx={p.x} cy={p.y} r={4.5}>
                      <title>{`${nameOf(i)} ${p.label}: ${p.value}`}</title>
                    </circle>
                  ) : (
                    <polygon key={p.index} className={`mk l${slot}`} points={poly}>
                      <title>{`${nameOf(i)} ${p.label}: ${p.value}`}</title>
                    </polygon>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      {spec.series.length > 1 && (
        <>
          <ul className="lx-legend">
            {spec.series.map((_, i) => {
              const slot = colourOf(i);
              const poly = markerPoints(shapeOf(i), 7, 7, 4.5);
              return (
                <li key={i}>
                  <button type="button" className={thin.has(spec.series[i].name.en) ? "thin" : ""} aria-pressed={on[i]} onClick={() => toggle(i)}>
                    <svg viewBox="0 0 14 14" aria-hidden>
                      {poly === null ? <circle className={`l${slot}`} cx={7} cy={7} r={4.5} /> : <polygon className={`l${slot}`} points={poly} />}
                    </svg>
                    {nameOf(i)}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="muted">
            <small>
              {pick(LINES.tapHint, lang)}
              {hidden > 0 ? ` ${fill(pick(LINES.hiddenCount, lang), { n: hidden })}.` : ""}{" "}
              <button type="button" className="secondary" style={{ padding: "2px 10px", fontSize: ".8rem" }} onClick={() => setOn(spec.series.map(() => true))}>
                {pick(LINES.showAll, lang)}
              </button>{" "}
              <button type="button" className="secondary" style={{ padding: "2px 10px", fontSize: ".8rem" }} onClick={() => setOn(spec.series.map((_, i) => i < LINES_ON_BY_DEFAULT))}>
                {pick(LINES.busiest, lang)}
              </button>
            </small>
          </p>
        </>
      )}
      <details className="lx-table">
        <summary>{pick(LINES.tableTitle, lang)}</summary>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{pick(LINES.match, lang)}</th>
                {spec.series.map((_, i) => (
                  <th key={i}>{nameOf(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  {spec.series.map((s, i) => {
                    const b = s.bars.find((x) => x.label === c);
                    return <td key={i}>{b ? b.value : pick(LINES.noPlay, lang)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
