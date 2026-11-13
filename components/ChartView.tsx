import { barWidthPct, type ChartSpec } from "@/lib/charts";
import { fill, pick, type Lang } from "@/lib/i18n";
import { CHARTS } from "@/lib/ui-text";
import LineChart from "./LineChart";

// Draws chart specs from lib/charts.ts: vertical columns (one group per member or club) or lines across matches. Plain
// HTML, CSS and SVG built by OUR code (never markup from a model). Colours are theme tokens, so light and dark both
// work, and every column and point has its value as text or a tooltip, so nothing depends on colour alone.

/** The tag after a value. Results show as a word in the reader's language; a number is a games count. */
function noteText(note: string | undefined, lang: Lang): string {
  if (!note) return "";
  if (note === "*") return " *";
  if (note === "W" || note === "D" || note === "L") return ` (${pick(CHARTS[note], lang)})`;
  return ` (${fill(pick(CHARTS.games, lang), { n: note })})`;
}

/** Height of a column as a percentage of the plot, using the same clamp as the old bars. */
export const columnHeightPct = barWidthPct;

function Columns({ c, lang }: { c: ChartSpec; lang: Lang }) {
  // Every series shares the chart's labels, in the first series' order, so the groups line up.
  const labels = [...new Set(c.series.flatMap((s) => s.bars.map((b) => b.label)))];
  const thin = new Set(c.thin ?? []);
  return (
    <div className="cols" role="img" aria-label={pick(c.title, lang)}>
      {labels.map((label) => (
        <div key={label} className={`cgroup ${thin.has(label) ? "thin" : ""}`}>
          <div className="cbars">
            {c.series.map((s, i) => {
              const bar = s.bars.find((b) => b.label === label);
              if (!bar) return <span key={i} className="ccol" />;
              return (
                <span key={i} className="ccol" title={`${label} · ${pick(s.name, lang)}: ${bar.value}${s.unit}${noteText(bar.note, lang)}`}>
                  <span className="cval">
                    {bar.value}
                    {s.unit}
                  </span>
                  <span className={`cfill s${i % 3}`} style={{ height: `${columnHeightPct(bar.value, c.max)}%` }} />
                </span>
              );
            })}
          </div>
          <div className="cname">{label}</div>
        </div>
      ))}
    </div>
  );
}

export default function ChartView({ charts, lang }: { charts: ChartSpec[]; lang: Lang }) {
  if (charts.length === 0) return null;
  return (
    <section className="charts">
      <h3>{pick(CHARTS.title, lang)}</h3>
      <p className="muted">
        <small>{pick(CHARTS.note, lang)}</small>
      </p>
      {charts.map((c) => {
        const multi = c.series.length > 1;
        return (
          <figure key={c.key} className="chart">
            <figcaption>{pick(c.title, lang)}</figcaption>
            {c.kind === "lines" ? (
              <LineChart spec={c} lang={lang} />
            ) : (
              <>
                {multi && (
                  <ul className="legend" aria-hidden>
                    {c.series.map((s, i) => (
                      <li key={i}>
                        <span className={`swatch s${i % 3}`} /> {pick(s.name, lang)}
                      </li>
                    ))}
                  </ul>
                )}
                <Columns c={c} lang={lang} />
              </>
            )}
            {c.footnote && (
              <p className="muted">
                <small>{pick(c.footnote, lang)}</small>
              </p>
            )}
          </figure>
        );
      })}
    </section>
  );
}
