"use client";

import { useEffect, useState } from "react";
import { analysisBlockers, describeBlocker, describeScope, describeTruncation, readTruncationTokens } from "@/lib/analysis-ui";
import { BOARD_LABEL, METRIC_LABEL, describeWarning, type ClubComparison, type ComparisonWarning, type MetricComparison } from "@/lib/club-compare";
import { askPath, removeAskClub, type AskClub } from "@/lib/ask-clubs";
import { PUBLIC_PLATFORMS } from "@/lib/public-clubs";
import type { Bi } from "@/lib/data-utils";

export type ClubNames = Record<string, string>;

type Provider = { configured: false; missing: string[]; problems: string[] } | { configured: true; host: string; model: string; demo: boolean; userDailyLimit: number };

// Mirrors lib/llm/report.ts. Every string is rendered as React text (escaped); never as HTML.
interface Report {
  language: "en" | "zh";
  headline: string;
  insufficientData: boolean;
  sections: Array<{ kind: string; title: string; items: string[] }>;
  tables: Array<{ title: string; columns: string[]; rows: string[][] }>;
  charts: Array<{ title: string; unit: string; labels: string[]; values: number[] }>;
}
interface Result {
  report: Report;
  comparison: Pick<ClubComparison, "mode" | "clubs" | "metrics" | "playerBoards" | "samePlatform" | "usableClubs"> & { warnings: ComparisonWarning[] };
  fetchedFromEa: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; estimated: boolean };
}

const bi = (b: Bi) => `${b.en} / ${b.zh}`;
const ERRORS: Record<string, Bi> = {
  unauthorized: { en: "Please sign in first.", zh: "請先登入。" },
  llm_not_configured: { en: "The AI service is not set up yet.", zh: "AI 服務尚未設定。" },
  club_not_found: { en: "EA has no club with that ID on that platform.", zh: "EA 喺呢個平台冇呢個編號嘅球會。" },
  upstream_blocked: { en: "EA appears to be blocking requests, so nothing was analysed. Try again later.", zh: "EA 似乎封鎖咗請求,所以冇分析任何資料。請稍後再試。" },
  ea_error: { en: "EA did not respond properly. Try again in a moment.", zh: "EA 冇正常回應,請稍後再試。" },
  busy: { en: "Too many requests right now. Wait a moment and try again.", zh: "而家請求太多,請稍後再試。" },
  too_large: { en: "These clubs hold too much data to analyse together. Try fewer clubs.", zh: "呢啲球會資料太多,無法一齊分析,請減少球會數目。" },
  budget: { en: "The daily analysis limit has been reached. Try again tomorrow.", zh: "已達今日分析上限,請明日再試。" },
  llm_failed: { en: "The AI service failed or timed out. Try again.", zh: "AI 服務出錯或逾時,請再試。" },
  llm_invalid_output: { en: "The AI answered in an unexpected format. Try again.", zh: "AI 回應格式有誤,請再試。" },
  llm_truncated: { en: "The AI answer hit the length limit and was cut off. Try a narrower question, or ask the site owner to raise the output limit.", zh: "AI 回應超出長度上限而被截斷。請縮窄問題,或者通知網站擁有人調高輸出上限。" },
  cost_exceeds_cap: { en: "The AI price or limit settings are inconsistent (one analysis could cost more than the daily cap). Ask the site owner to check them.", zh: "AI 價格或限額設定不一致(一次分析可能超過每日上限),請通知網站擁有人檢查。" },
  internal_error: { en: "An unexpected server error occurred.", zh: "伺服器發生未預期錯誤。" },
};

export default function AnalysisClient({ initialClubs, names, provider, max }: { initialClubs: AskClub[]; names: ClubNames; provider: Provider; max: number }) {
  const clubs = initialClubs;
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<(Bi & { detail?: Bi }) | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [platform, setPlatform] = useState<(typeof PUBLIC_PLATFORMS)[number]>(clubs[0]?.platform === "nx" ? "nx" : "common-gen5");

  // Remember the privacy acknowledgement per provider+model. Storage can be unavailable; never rely on it.
  const ackKey = provider.configured ? `ai-notice:${provider.host}:${provider.model}` : "";
  useEffect(() => {
    if (!ackKey) return;
    try {
      if (window.localStorage.getItem(ackKey) === "1") setAgreed(true);
    } catch {
      /* ignore */
    }
  }, [ackKey]);
  function setAck(v: boolean) {
    setAgreed(v);
    try {
      if (ackKey) v ? window.localStorage.setItem(ackKey, "1") : window.localStorage.removeItem(ackKey);
    } catch {
      /* ignore */
    }
  }

  const gate = {
    configured: provider.configured,
    demo: provider.configured && provider.demo,
    agreed,
    busy,
    clubs: clubs.length,
    minClubs: 1,
    maxClubs: max,
    question,
  };
  const blockers = analysisBlockers(gate);
  const canRun = blockers.length === 0;
  const scope = describeScope(gate);
  const clubsValue = clubs.map((c) => `${c.clubId}.${c.platform}`).join(",");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!canRun) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clubs, question: question.trim(), language }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = body && typeof body.error === "string" ? body.error : "";
        const base = ERRORS[code] ?? { en: `Something went wrong (HTTP ${res.status}).`, zh: `發生錯誤(HTTP ${res.status})。` };
        const refTxt = body && typeof body.ref === "string" ? ` (ref ${body.ref}${typeof body.code === "string" ? `, code ${body.code}` : ""})` : "";
        // Only a cut-off answer carries token counts. They are shown so the user can see how close the answer came.
        const tokens = code === "llm_truncated" ? readTruncationTokens(body) : null;
        setError({ en: base.en + refTxt, zh: base.zh + refTxt, detail: tokens ? describeTruncation(tokens) : undefined });
        return;
      }
      setResult(body as Result);
    } catch {
      setError({ en: "Network error.", zh: "網絡錯誤。" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Ask AI / 問 AI</h1>
      <p>
        Ask about one club and its members, or add 2 to 4 clubs to compare clubs with each other, or members across clubs. Club data comes live from EA and is shared for about 15 minutes, so repeat questions are quick. The numbers are computed by this app; the AI explains them. / 可以問一個球會同佢嘅球員;或者加入 2 至 4 個球會,比較球會之間,或者唔同球會嘅球員之間。球會資料即時來自 EA,並共用約 15 分鐘,所以重複提問會比較快。數字由本程式計算,AI 負責解釋。
      </p>

      {!provider.configured && (
        <div role="alert" style={{ color: "#b00020" }}>
          <p>The AI service is not set up yet, so analysis is unavailable. / AI 服務尚未設定,暫時未能分析。</p>
          {(provider.missing.length > 0 || provider.problems.length > 0) && (
            <ul>
              {provider.missing.map((name) => (
                <li key={name}>Missing setting / 缺少設定: {name}</li>
              ))}
              {provider.problems.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {provider.configured && provider.demo && (
        <p role="note" style={{ color: "#8a5a00" }}>
          Demo mode: a fake provider is active. Nothing is sent to any AI service, and the output is placeholder text, not real analysis. / 示範模式:目前用緊假供應商,唔會傳送任何資料畀 AI 服務,輸出只係示範文字,並非真正分析。
        </p>
      )}

      {provider.configured && !provider.demo && (
        <section style={{ border: "1px solid #8884", borderRadius: 6, padding: 10, margin: "12px 0" }}>
          <strong>Privacy notice / 私隱聲明</strong>
          <p style={{ margin: "6px 0" }}>
            Your question and the club data being compared, including player gamer tags and opponents&apos; names, are sent to the AI service ({provider.host}, model {provider.model}) to write the report. Do not include anything private in your question.
          </p>
          <p style={{ margin: "6px 0" }}>
            你嘅問題同被比較嘅球會資料(包括球員玩家名稱同對手名稱)會傳送到 AI 服務({provider.host},模型 {provider.model})以產生報告。請勿喺問題入面輸入私人資料。
          </p>
          <label>
            <input type="checkbox" checked={agreed} onChange={(e) => setAck(e.target.checked)} /> I understand / 我明白
          </label>
        </section>
      )}

      <h2>1. Choose clubs / 揀球會 ({clubs.length} / {max})</h2>
      {clubs.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {clubs.map((c) => (
            <li key={`${c.clubId}.${c.platform}`} style={{ margin: "4px 0" }}>
              <strong>{names[`${c.clubId}.${c.platform}`] ?? `Club ${c.clubId}`}</strong> · {c.platform === "nx" ? "Nintendo Switch" : "PlayStation / Xbox / PC"} · ID {c.clubId}{" "}
              <a href={askPath(removeAskClub(clubs, c))}>Remove / 移除</a>
            </li>
          ))}
        </ul>
      )}
      {clubs.length < max && (
        <form action="/search" method="get" className="search" style={{ justifyContent: "flex-start" }}>
          <input type="hidden" name="clubs" value={clubsValue} />
          <input type="text" name="name" placeholder="Search a club to add / 搜尋球會並加入" aria-label="Club name / 球會名稱" minLength={2} maxLength={50} required />
          <select name="platform" value={platform} onChange={(e) => setPlatform(e.target.value as (typeof PUBLIC_PLATFORMS)[number])} aria-label="Platform / 平台">
            {PUBLIC_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p === "common-gen5" ? "PlayStation / Xbox / PC" : "Nintendo Switch"}
              </option>
            ))}
          </select>
          <button type="submit">Add club / 加入球會</button>
        </form>
      )}
      <p role="status">
        <small>{scope.en} / {scope.zh}</small>
      </p>

      <form onSubmit={run}>
        <h2>2. Ask / 提問</h2>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          rows={3}
          required
          style={{ width: "100%" }}
          placeholder="One club: Who scores the most, and who passes best? / 一個球會:邊個入球最多?邊個傳球最準?  Several clubs: Which club defends best? / 多個球會:邊個球會防守最好?"
        />
        <p>
          Report language / 報告語言:{" "}
          <select value={language} onChange={(e) => setLanguage(e.target.value as "zh" | "en")}>
            <option value="zh">粵語 (Traditional Cantonese)</option>
            <option value="en">English</option>
          </select>
        </p>
        <button type="submit" disabled={!canRun}>
          {busy ? "Analysing… / 分析緊…" : "Analyse / 分析"}
        </button>
        {!canRun && !busy && (
          <ul role="status" style={{ color: "#8a5a00", margin: "8px 0", paddingLeft: 18 }}>
            {blockers.map((b) => {
              const t = describeBlocker(b, { min: 1, max });
              return <li key={b}>{t.en} / {t.zh}</li>;
            })}
          </ul>
        )}
        {provider.configured && (
          <p>
            <small>Limit: {provider.userDailyLimit} analyses per day. May take up to a minute. / 每日上限 {provider.userDailyLimit} 次,最多需時約一分鐘。</small>
          </p>
        )}
      </form>

      {error && (
        <div role="alert" style={{ color: "#b00020" }}>
          <p>{bi(error)}</p>
          {error.detail && (
            <p>
              <small>
                {error.detail.en}
                <br />
                {error.detail.zh}
              </small>
            </p>
          )}
        </div>
      )}
      {result && <ReportView r={result} />}
    </main>
  );
}

function ReportView({ r }: { r: Result }) {
  const { report } = r;
  return (
    <section style={{ marginTop: 20 }}>
      <h2>{report.headline}</h2>
      {report.insufficientData && (
        <p role="note" style={{ color: "#8a5a00" }}>
          Not enough data for firm conclusions. / 資料不足,結論只供參考。
        </p>
      )}
      {r.comparison.warnings.length > 0 && (
        <div style={{ border: "1px solid #8a5a0066", borderRadius: 6, padding: 8, margin: "8px 0" }}>
          <strong>Data warnings (from the app, not the AI) / 資料提示(由程式產生,非 AI)</strong>
          <ul>
            {r.comparison.warnings.map((w, i) => {
              const t = describeWarning(w);
              return (
                <li key={i}>
                  {t.en}
                  <br />
                  {t.zh}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <ComputedNumbers c={r.comparison} />
      {report.sections.map((s, i) => (
        <div key={i}>
          <h3>{s.title}</h3>
          <ul>
            {s.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ul>
        </div>
      ))}
      {report.tables.map((t, i) => (
        <div key={i} style={{ overflowX: "auto" }}>
          <h3>{t.title}</h3>
          <table>
            <thead>
              <tr>
                {t.columns.map((c, j) => (
                  <th key={j}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, j) => (
                <tr key={j}>
                  {row.map((cell, k) => (
                    <td key={k}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {report.charts.map((c, i) => (
        <BarChart key={i} title={c.title} unit={c.unit} labels={c.labels} values={c.values} />
      ))}
      <p>
        <small>
          AI-written text; check it against the numbers. Tokens {r.usage.inputTokens} in / {r.usage.outputTokens} out
          {r.usage.estimated ? " (estimated)" : ""}. / 內容由 AI 撰寫,請對照數字核實。
        </small>
      </p>
      <style>{`table { border-collapse: collapse; margin: 6px 0 14px; } th, td { padding: 2px 10px 2px 0; text-align: left; }`}</style>
    </section>
  );
}

function BarChart({ title, unit, labels, values }: { title: string; unit: string; labels: string[]; values: number[] }) {
  const maxAbs = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  return (
    <div>
      <h3>
        {title}
        {unit ? ` (${unit})` : ""}
      </h3>
      {labels.map((l, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
          <span style={{ width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</span>
          <span
            aria-hidden
            style={{ display: "inline-block", height: 12, width: `${(Math.abs(values[i]) / maxAbs) * 60}%`, background: values[i] < 0 ? "#b00020" : "#2f6fdb", minWidth: 2 }}
          />
          <span>{values[i]}</span>
        </div>
      ))}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
const num = (v: number | null) => (v === null ? "–" : String(v));

/** The numbers our code computed (not the AI): the tables the AI text is explaining. */
function ComputedNumbers({ c }: { c: Result["comparison"] }) {
  const single = c.mode === "single";
  const nameOf = new Map(c.clubs.map((x) => [x.id, x.name ?? x.label]));
  return (
    <div>
      <h3>{single ? "Club statistics (by the app) / 球會統計(程式計算)" : "Computed comparison (by the app) / 程式計算嘅比較"}</h3>
      {single ? <SingleClub club={c.clubs[0]} /> : <ClubTable c={c} />}
      {!single && <BoardTables c={c} nameOf={nameOf} />}
      <p>
        <small>Crossing and dribbling are not stored, so they cannot be compared. / 未有儲存傳中同盤帶數據,所以無法比較。</small>
      </p>
    </div>
  );
}

function SingleClub({ club }: { club: Result["comparison"]["clubs"][number] }) {
  const r = club.record;
  return (
    <div>
      {r && (
        <p>
          {club.name ?? club.label}: {num(r.games)} played / 場 · {num(r.wins)}W {num(r.ties)}D {num(r.losses)}L · goals / 入球 {num(r.goals)}–{num(r.goalsAgainst)} · skill rating / 技術評分 {num(club.skillRating)}
          {club.recentForm && <> · recent form / 近期戰績 {club.recentForm.results.join("")}</>}
        </p>
      )}
      <h4>Members / 球員 ({club.members.length})</h4>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Name / 名</th>
              <th>Pos / 位置</th>
              <th>GP / 場</th>
              <th>G / 入球</th>
              <th>A / 助攻</th>
              <th>G per game / 場均入球</th>
              <th>Rating / 評分</th>
              <th>Pass % / 傳球</th>
              <th>Shot % / 射門</th>
              <th>Tackle % / 搶截</th>
              <th>MOTM</th>
              <th>Career GP / 生涯場</th>
              <th>Career G / 生涯入球</th>
            </tr>
          </thead>
          <tbody>
            {club.members.map((m) => (
              <tr key={m.name} style={m.ranked ? undefined : { opacity: 0.65 }}>
                <td>{m.name}{m.ranked ? "" : " *"}</td>
                <td>{m.pos ?? "–"}</td>
                <td>{num(m.games)}</td>
                <td>{num(m.goals)}</td>
                <td>{num(m.assists)}</td>
                <td>{num(m.goalsPerGame)}</td>
                <td>{num(m.rating)}</td>
                <td>{pct(m.passPct)}</td>
                <td>{pct(m.shotPct)}</td>
                <td>{pct(m.tacklePct)}</td>
                <td>{num(m.motm)}</td>
                <td>{num(m.careerGames)}</td>
                <td>{num(m.careerGoals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <small>* fewer than 5 games, so not ranked on rates / 少於 5 場,不計入比率排名</small>
      </p>
    </div>
  );
}

function ClubTable({ c }: { c: Result["comparison"] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Metric / 指標</th>
            {c.clubs.map((x) => (
              <th key={x.id}>{x.name ?? x.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.metrics.map((m: MetricComparison) => (
            <tr key={m.key}>
              <td>
                {METRIC_LABEL[m.key].en} / {METRIC_LABEL[m.key].zh}
              </td>
              {c.clubs.map((x) => {
                const e = m.entries.find((y) => y.id === x.id);
                return (
                  <td key={x.id}>
                    {e?.value ?? "–"}
                    {e?.rank != null ? ` (#${e.rank})` : e?.value != null ? " (not ranked / 未排名)" : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardTables({ c, nameOf }: { c: Result["comparison"]; nameOf: Map<string, string> }) {
  return (
    <>
      {c.playerBoards
        .filter((b) => b.entries.length > 0)
        .map((b) => (
          <div key={b.key} style={{ overflowX: "auto" }}>
            <h4>
              {BOARD_LABEL[b.key].en} / {BOARD_LABEL[b.key].zh} <small>(members across all clubs, min {b.minGames} games / 跨球會嘅球員,最少 {b.minGames} 場)</small>
            </h4>
            <table>
              <tbody>
                {b.entries.slice(0, 5).map((e) => (
                  <tr key={`${e.clubId}:${e.name}`}>
                    <td>#{e.rank}</td>
                    <td>{e.name}</td>
                    <td>{nameOf.get(e.clubId) ?? e.clubName}</td>
                    <td>{e.games} games / 場</td>
                    <td>
                      <strong>{e.value}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
}
