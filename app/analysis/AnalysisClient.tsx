"use client";

import { useEffect, useState } from "react";
import { analysisBlockers, describeBlocker, describeScope, describeTruncation, readTruncationTokens } from "@/lib/analysis-ui";
import { BOARD_LABEL, METRIC_LABEL, describeWarning, type ClubComparison, type ComparisonWarning, type MetricComparison } from "@/lib/club-compare";
import { askPath, removeAskClub, type AskClub } from "@/lib/ask-clubs";
import { PUBLIC_PLATFORMS } from "@/lib/public-clubs";
import { fill, pick, type Bi, type Lang } from "@/lib/i18n";
import { ASK, MEMBER_COLS, THREAD } from "@/lib/ui-text";
import { historyOf, parseStoredThread, serializeThread, threadFull, threadKey, turnsLeft, type ThreadTurn } from "@/lib/ask-thread";

export type ClubNames = Record<string, string>;

type Provider = { configured: false; missing: string[]; problems: string[] } | { configured: true; host: string; model: string; demo: boolean; userDailyLimit: number; maxTurns: number };

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
  answerSummary: string;
  maxTurns: number;
  comparison: Pick<ClubComparison, "mode" | "clubs" | "metrics" | "playerBoards" | "samePlatform" | "usableClubs"> & { warnings: ComparisonWarning[] };
  fetchedFromEa: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number; estimated: boolean };
}

/** One turn on screen: the question, and the full report if it was answered on this page (not after a reload). */
interface Shown {
  question: string;
  summary: string;
  result: Result | null;
}

const ERRORS: Record<string, Bi> = {
  turn_limit: THREAD.turnLimitError,
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

export default function AnalysisClient({ initialClubs, names, provider, max, lang }: { initialClubs: AskClub[]; names: ClubNames; provider: Provider; max: number; lang: Lang }) {
  const clubs = initialClubs;
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"zh" | "en">(lang);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; detail?: string } | null>(null);
  const [shown, setShown] = useState<Shown[]>([]);
  const maxTurns = provider.configured ? provider.maxTurns : 8;
  const [platform, setPlatform] = useState<(typeof PUBLIC_PLATFORMS)[number]>(clubs[0]?.platform === "nx" ? "nx" : "common-gen5");

  // The conversation lives in this tab only (sessionStorage): nothing is stored on the server. It is keyed by the chosen
  // clubs, so changing the clubs starts a new conversation. Storage can be unavailable or hold junk; start fresh then.
  const clubsKey = clubs.map((c) => `${c.clubId}.${c.platform}`).join(",");
  useEffect(() => {
    if (clubsKey === "") return;
    try {
      const t = parseStoredThread(window.sessionStorage.getItem(threadKey(clubsKey)), maxTurns);
      if (t && t.turns.length > 0) {
        setShown(t.turns.map((x) => ({ question: x.question, summary: x.summary, result: null })));
        setLanguage(t.language);
      }
    } catch {
      /* ignore */
    }
  }, [clubsKey, maxTurns]);
  function saveThread(next: Shown[], lang2: "en" | "zh") {
    try {
      const turns: ThreadTurn[] = next.map((x) => ({ question: x.question, summary: x.summary }));
      if (turns.length === 0) window.sessionStorage.removeItem(threadKey(clubsKey));
      else window.sessionStorage.setItem(threadKey(clubsKey), serializeThread(lang2, turns));
    } catch {
      /* ignore */
    }
  }
  function newConversation() {
    if (shown.length > 0 && !window.confirm(pick(THREAD.newChatConfirm, lang))) return;
    setShown([]);
    setError(null);
    saveThread([], language);
  }

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

  const full = threadFull(shown.length, maxTurns);
  const gate = {
    configured: provider.configured,
    demo: provider.configured && provider.demo,
    agreed,
    busy: busy || full,
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
    if (!canRun || full) return;
    const asked = question.trim();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clubs, question: asked, language, history: historyOf(shown) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = body && typeof body.error === "string" ? body.error : "";
        const base = pick(ERRORS[code] ?? { en: fill(ASK.httpError.en, { status: res.status }), zh: fill(ASK.httpError.zh, { status: res.status }) }, lang);
        const refTxt = body && typeof body.ref === "string" ? ` (ref ${body.ref}${typeof body.code === "string" ? `, code ${body.code}` : ""})` : "";
        // Only a cut-off answer carries token counts. They are shown so the user can see how close the answer came.
        const tokens = code === "llm_truncated" ? readTruncationTokens(body) : null;
        setError({ text: base + refTxt, detail: tokens ? pick(describeTruncation(tokens), lang) : undefined });
        return; // a failed question is not added to the conversation, so it does not use up a turn on screen
      }
      const r = body as Result;
      const summary = typeof r.answerSummary === "string" ? r.answerSummary : "";
      // Earlier turns keep whatever result they had; the newest carries its full result. appendTurn enforces the limit.
      const kept = shown.length >= maxTurns ? shown.slice(shown.length - maxTurns + 1) : shown;
      const next: Shown[] = [...kept, { question: asked, summary, result: r }];
      setShown(next);
      setQuestion("");
      saveThread(next, language);
    } catch {
      setError({ text: pick(ASK.networkError, lang) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wide">
      <h1>{pick(ASK.title, lang)}</h1>
      <p>{pick(ASK.intro, lang)}</p>

      {!provider.configured && (
        <div role="alert" className="error-text">
          <p>{pick(ASK.notSetUp, lang)}</p>
          {(provider.missing.length > 0 || provider.problems.length > 0) && (
            <ul>
              {provider.missing.map((name) => (
                <li key={name}>{pick(ASK.missingSetting, lang)}: {name}</li>
              ))}
              {provider.problems.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {provider.configured && provider.demo && (
        <p role="note" className="warn-text">
          {pick(ASK.demo, lang)}
        </p>
      )}

      {provider.configured && !provider.demo && (
        <section className="panel">
          <strong>{pick(ASK.privacyTitle, lang)}</strong>
          <p>{fill(pick(ASK.privacy, lang), { host: provider.host, model: provider.model })}</p>
          <label>
            <input type="checkbox" checked={agreed} onChange={(e) => setAck(e.target.checked)} /> {pick(ASK.understand, lang)}
          </label>
        </section>
      )}

      <h2>
        {pick(ASK.step1, lang)} ({clubs.length} / {max})
      </h2>
      {clubs.length > 0 && (
        <ul className="chosen">
          {clubs.map((c) => (
            <li key={`${c.clubId}.${c.platform}`}>
              <strong>{names[`${c.clubId}.${c.platform}`] ?? `Club ${c.clubId}`}</strong> · {c.platform === "nx" ? "Nintendo Switch" : "PlayStation / Xbox / PC"} · ID {c.clubId}{" "}
              <a href={askPath(removeAskClub(clubs, c))}>{pick(ASK.remove, lang)}</a>
            </li>
          ))}
        </ul>
      )}
      {clubs.length < max && (
        <form action="/search" method="get" className="search left">
          <input type="hidden" name="clubs" value={clubsValue} />
          <input type="text" name="name" placeholder={pick(ASK.searchPlaceholder, lang)} aria-label={pick(ASK.clubName, lang)} minLength={2} maxLength={50} required />
          <select name="platform" value={platform} onChange={(e) => setPlatform(e.target.value as (typeof PUBLIC_PLATFORMS)[number])} aria-label={pick(ASK.platform, lang)}>
            {PUBLIC_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p === "common-gen5" ? "PlayStation / Xbox / PC" : "Nintendo Switch"}
              </option>
            ))}
          </select>
          <button type="submit">{pick(ASK.addClub, lang)}</button>
        </form>
      )}
      <p role="status">
        <small>{pick(scope, lang)}</small>
      </p>

      {shown.length > 0 && (
        <section className="thread" aria-label={pick(THREAD.youAsked, lang)}>
          {shown.map((t, i) => (
            <div key={i} className="turn">
              <p className="you">
                <strong>{pick(THREAD.youAsked, lang)}:</strong> {t.question}
              </p>
              {t.result ? (
                <ReportView r={t.result} lang={lang} />
              ) : (
                <div className="panel">
                  <small className="muted">{pick(THREAD.summaryLabel, lang)}</small>
                  <p>{t.summary || "–"}</p>
                </div>
              )}
            </div>
          ))}
          {shown.some((t) => t.result === null) && (
            <p className="muted">
              <small>{pick(THREAD.restored, lang)}</small>
            </p>
          )}
          <p className="muted">
            <small>{threadFull(shown.length, maxTurns) ? fill(pick(THREAD.full, lang), { max: maxTurns }) : turnsLeft(shown.length, maxTurns) === 1 ? pick(THREAD.leftOne, lang) : fill(pick(THREAD.left, lang), { n: turnsLeft(shown.length, maxTurns) })}</small>
          </p>
          <button type="button" className="secondary" onClick={newConversation}>
            {pick(THREAD.newChat, lang)}
          </button>
        </section>
      )}

      <form onSubmit={run}>
        <h2>{pick(ASK.step2, lang)}</h2>
        {shown.length > 0 && <p className="muted"><small>{pick(THREAD.sameData, lang)}</small></p>}
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          rows={3}
          required
          placeholder={pick(shown.length > 0 ? THREAD.followUp : ASK.questionPlaceholder, lang)}
        />
        {shown.length > 0 && (
          <p className="muted">
            <small>{pick(THREAD.langFixed, lang)}</small>
          </p>
        )}
        <p>
          {pick(ASK.reportLang, lang)}:{" "}
          <select value={language} disabled={shown.length > 0} onChange={(e) => setLanguage(e.target.value as "zh" | "en")}>
            <option value="zh">{pick(ASK.langZh, lang)}</option>
            <option value="en">{pick(ASK.langEn, lang)}</option>
          </select>
        </p>
        <button type="submit" disabled={!canRun}>
          {pick(busy ? ASK.analysing : ASK.analyse, lang)}
        </button>
        {!canRun && !busy && (
          <ul role="status" className="warn-list">
            {blockers.map((b) => {
              const t = describeBlocker(b, { min: 1, max });
              return <li key={b}>{pick(t, lang)}</li>;
            })}
          </ul>
        )}
        {provider.configured && (
          <p>
            <small>{fill(pick(ASK.limit, lang), { n: provider.userDailyLimit })}</small>
          </p>
        )}
      </form>

      {error && (
        <div role="alert" className="error-text">
          <p>{error.text}</p>
          {error.detail && (
            <p>
              <small>{error.detail}</small>
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function ReportView({ r, lang }: { r: Result; lang: Lang }) {
  const { report } = r;
  return (
    <section>
      <h2>{report.headline}</h2>
      {report.insufficientData && (
        <p role="note" className="warn-text">
          {pick(ASK.notEnough, lang)}
        </p>
      )}
      {r.comparison.warnings.length > 0 && (
        <div className="panel warn">
          <strong>{pick(ASK.warnTitle, lang)}</strong>
          <ul>
            {r.comparison.warnings.map((w, i) => (
              <li key={i}>{pick(describeWarning(w), lang)}</li>
            ))}
          </ul>
        </div>
      )}
      <ComputedNumbers c={r.comparison} lang={lang} />
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
        <div key={i} className="tablewrap">
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
          {pick(ASK.aiNote, lang)} {fill(pick(ASK.tokens, lang), { in: r.usage.inputTokens, out: r.usage.outputTokens })}
          {r.usage.estimated ? ` ${pick(ASK.estimated, lang)}` : ""}
        </small>
      </p>
    </section>
  );
}

function BarChart({ title, unit, labels, values }: { title: string; unit: string; labels: string[]; values: number[] }) {
  const maxAbs = Math.max(1e-9, ...values.map((v) => Math.abs(v)));
  return (
    <div className="bars">
      <h3>
        {title}
        {unit ? ` (${unit})` : ""}
      </h3>
      {labels.map((l, i) => (
        <div key={i} className="row">
          <span className="label">{l}</span>
          <span aria-hidden className={values[i] < 0 ? "bar neg" : "bar"} style={{ width: `${(Math.abs(values[i]) / maxAbs) * 60}%` }} />
          <span>{values[i]}</span>
        </div>
      ))}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
const num = (v: number | null) => (v === null ? "–" : String(v));

/** The numbers our code computed (not the AI): the tables the AI text is explaining. */
function ComputedNumbers({ c, lang }: { c: Result["comparison"]; lang: Lang }) {
  const single = c.mode === "single";
  const nameOf = new Map(c.clubs.map((x) => [x.id, x.name ?? x.label]));
  return (
    <div>
      <h3>{pick(single ? ASK.computedOne : ASK.computedMany, lang)}</h3>
      {single ? <SingleClub club={c.clubs[0]} lang={lang} /> : <ClubTable c={c} lang={lang} />}
      {!single && <BoardTables c={c} nameOf={nameOf} lang={lang} />}
      <p>
        <small>{pick(ASK.noCrossing, lang)}</small>
      </p>
    </div>
  );
}

function SingleClub({ club, lang }: { club: Result["comparison"]["clubs"][number]; lang: Lang }) {
  const r = club.record;
  return (
    <div>
      {r && (
        <p>
          {club.name ?? club.label}: {num(r.games)} {pick(ASK.playedWord, lang)} · {num(r.wins)}W {num(r.ties)}D {num(r.losses)}L · {pick(ASK.goalsWord, lang)} {num(r.goals)}–{num(r.goalsAgainst)} · {pick(ASK.skillWord, lang)} {num(club.skillRating)}
          {club.recentForm && <> · {pick(ASK.formWord, lang)} {club.recentForm.results.join("")}</>}
        </p>
      )}
      <h4>
        {pick(ASK.members, lang)} ({club.members.length})
      </h4>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>{pick(MEMBER_COLS.name, lang)}</th>
              <th>{pick(MEMBER_COLS.pos, lang)}</th>
              <th>{pick(MEMBER_COLS.gp, lang)}</th>
              <th>{pick(MEMBER_COLS.g, lang)}</th>
              <th>{pick(MEMBER_COLS.a, lang)}</th>
              <th>{pick(MEMBER_COLS.gpg, lang)}</th>
              <th>{pick(MEMBER_COLS.rating, lang)}</th>
              <th>{pick(MEMBER_COLS.pass, lang)}</th>
              <th>{pick(MEMBER_COLS.shot, lang)}</th>
              <th>{pick(MEMBER_COLS.tackle, lang)}</th>
              <th>{pick(MEMBER_COLS.motm, lang)}</th>
              <th>{pick(MEMBER_COLS.careerGp, lang)}</th>
              <th>{pick(MEMBER_COLS.careerG, lang)}</th>
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
        <small>{pick(ASK.notRankedNote, lang)}</small>
      </p>
    </div>
  );
}

function ClubTable({ c, lang }: { c: Result["comparison"]; lang: Lang }) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>{pick(ASK.metric, lang)}</th>
            {c.clubs.map((x) => (
              <th key={x.id}>{x.name ?? x.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.metrics.map((m: MetricComparison) => (
            <tr key={m.key}>
              <td>
                {pick(METRIC_LABEL[m.key], lang)}
              </td>
              {c.clubs.map((x) => {
                const e = m.entries.find((y) => y.id === x.id);
                return (
                  <td key={x.id}>
                    {e?.value ?? "–"}
                    {e?.rank != null ? ` (#${e.rank})` : e?.value != null ? ` (${pick(ASK.notRanked, lang)})` : ""}
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

function BoardTables({ c, nameOf, lang }: { c: Result["comparison"]; nameOf: Map<string, string>; lang: Lang }) {
  return (
    <>
      {c.playerBoards
        .filter((b) => b.entries.length > 0)
        .map((b) => (
          <div key={b.key} className="tablewrap">
            <h4>
              {pick(BOARD_LABEL[b.key], lang)} <small>({fill(pick(ASK.boardNote, lang), { n: b.minGames })})</small>
            </h4>
            <table>
              <tbody>
                {b.entries.slice(0, 5).map((e) => (
                  <tr key={`${e.clubId}:${e.name}`}>
                    <td>#{e.rank}</td>
                    <td>{e.name}</td>
                    <td>{nameOf.get(e.clubId) ?? e.clubName}</td>
                    <td>{e.games} {pick(ASK.gamesWord, lang)}</td>
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
