import { barWidthPct, type ChartSpec } from "@/lib/charts";
import { fill, pick, type Lang } from "@/lib/i18n";
import { CHARTS } from "@/lib/ui-text";

// Draws chart specs from lib/charts.ts as grouped horizontal bars. Plain HTML and CSS (no library, no SVG from a
// model): the colours are theme tokens, so light and dark both work, and each bar has its value as text, so nothing
// depends on colour alone.
/** The tag after a bar's value. Results show as a word in the reader's language; a number is a games count. */
function noteText(note: string | undefined, lang: Lang): string {
  if (!note) return "";
  if (note === "*") return " *";
  if (note === "W" || note === "D" || note === "L") return ` (${pick(CHARTS[note], lang)})`;
  return ` (${fill(pick(CHARTS.games, lang), { n: note })})`;
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
        // Every series shares the chart's labels, in the first series' order, so groups line up.
        const labels = [...new Set(c.series.flatMap((s) => s.bars.map((b) => b.label)))];
        const multi = c.series.length > 1;
        return (
          <figure key={c.key} className="chart">
            <figcaption>{pick(c.title, lang)}</figcaption>
            {multi && (
              <ul className="legend" aria-hidden>
                {c.series.map((s, i) => (
                  <li key={i}>
                    <span className={`swatch s${i % 3}`} /> {pick(s.name, lang)}
                  </li>
                ))}
              </ul>
            )}
            {labels.map((label) => (
              <div key={label} className="group">
                <div className="glabel">{label}</div>
                {c.series.map((s, i) => {
                  const bar = s.bars.find((b) => b.label === label);
                  if (!bar) return null;
                  return (
                    <div key={i} className="brow">
                      <span className="bname">{pick(s.name, lang)}</span>
                      <span className="track">
                        <span className={`fill s${i % 3}`} style={{ width: `${barWidthPct(bar.value, c.max)}%` }} />
                      </span>
                      <span className="bval">
                        {bar.value}
                        {s.unit}
                        {noteText(bar.note, lang)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
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
