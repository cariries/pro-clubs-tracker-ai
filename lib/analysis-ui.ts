// Pure rules for the Ask AI page, kept out of the React component so they can be unit-tested (there is no
// component test setup). `analysisBlockers` lists WHY the button is disabled, so the page can say so instead
// of showing a dead button.
export interface RunGate {
  configured: boolean;
  /** The keyless fake provider: nothing leaves the app, so there is nothing to consent to. */
  demo: boolean;
  /** The user ticked the privacy notice (only shown for a real provider). */
  agreed: boolean;
  busy: boolean;
  /** Clubs the user has added to this question. */
  clubs: number;
  minClubs: number;
  maxClubs: number;
  question: string;
}

export type Blocker = "not_configured" | "add_a_club" | "too_many_clubs" | "type_question" | "tick_privacy" | "busy";

export const BLOCKER_TEXT: Record<Blocker, { en: string; zh: string }> = {
  not_configured: { en: "The AI service is not set up.", zh: "AI 服務尚未設定。" },
  add_a_club: { en: "Add at least {min} club using the search box above.", zh: "請用上面嘅搜尋框加入至少 {min} 個球會。" },
  too_many_clubs: { en: "You can ask about at most {max} clubs at once. Remove some.", zh: "一次最多問 {max} 個球會,請移除部分。" },
  type_question: { en: "Type a question.", zh: "請輸入問題。" },
  tick_privacy: { en: "Tick \"I understand\" in the privacy notice.", zh: "請剔選私隱聲明入面嘅「我明白」。" },
  busy: { en: "Analysing…", zh: "分析緊…" },
};

/** Everything currently stopping the button from working, in the order the user should fix it. */
export function analysisBlockers(g: RunGate): Blocker[] {
  if (!g.configured) return ["not_configured"];
  const out: Blocker[] = [];
  if (g.clubs < g.minClubs) out.push("add_a_club");
  else if (g.clubs > g.maxClubs) out.push("too_many_clubs");
  if (g.question.trim().length === 0) out.push("type_question");
  if (!g.demo && !g.agreed) out.push("tick_privacy");
  if (g.busy) out.push("busy");
  return out;
}

export function canRunAnalysis(g: RunGate): boolean {
  return analysisBlockers(g).length === 0;
}

export function describeBlocker(b: Blocker, vars: { min: number; max: number }): { en: string; zh: string } {
  const t = BLOCKER_TEXT[b];
  const fill = (s: string) => s.replace(/\{min\}/g, String(vars.min)).replace(/\{max\}/g, String(vars.max));
  return { en: fill(t.en), zh: fill(t.zh) };
}

/** What the Ask AI button will do, in words, so the user is never surprised about which clubs are used. */
export function describeScope(g: Pick<RunGate, "clubs" | "maxClubs">): { en: string; zh: string } {
  if (g.clubs === 0) return { en: `Search for a club above to add it (up to ${g.maxClubs}).`, zh: `用上面嘅搜尋框搜尋並加入球會(最多 ${g.maxClubs} 個)。` };
  if (g.clubs === 1) return { en: "Looking at this 1 club and its members. Add another club to compare.", zh: "會睇呢 1 個球會同佢嘅球員。再加一個球會就可以比較。" };
  return { en: `Comparing these ${g.clubs} clubs (clubs against each other, and members across clubs).`, zh: `會比較呢 ${g.clubs} 個球會(球會之間,以及唔同球會嘅球員之間)。` };
}

/** Token figures for an answer that hit the output limit. Safe to show: counts only, no prompt text, no cost. */
export interface TruncationTokens {
  inputTokens: number;
  outputTokens: number;
  /** The output-token limit the owner configured (LLM_MAX_OUTPUT_TOKENS). */
  limit: number;
  /** True when the provider gave no count and the numbers are our estimate. */
  estimated: boolean;
}

const grouped = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const okCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Reads the `tokens` field of an error response without trusting it. Null if it is missing or malformed. */
export function readTruncationTokens(body: unknown): TruncationTokens | null {
  if (typeof body !== "object" || body === null) return null;
  const t = (body as Record<string, unknown>).tokens;
  if (typeof t !== "object" || t === null) return null;
  const { inputTokens, outputTokens, limit, estimated } = t as Record<string, unknown>;
  if (!okCount(inputTokens) || !okCount(outputTokens) || !okCount(limit) || limit <= 0 || typeof estimated !== "boolean") return null;
  return { inputTokens, outputTokens, limit, estimated };
}

/**
 * Plain-language token explanation for a cut-off answer, in English and Cantonese. It never claims to know how
 * long the full answer would have been: the model was stopped, so only "more than the limit" is true.
 */
export function describeTruncation(t: TruncationTokens): { en: string; zh: string } {
  const inp = grouped(t.inputTokens);
  const out = grouped(t.outputTokens);
  const lim = grouped(t.limit);
  if (t.estimated) {
    return {
      en: `The AI service gave no token count, so these are estimates: about ${inp} input tokens (your question and the club data) and about ${out} output tokens written before the cut-off. The output limit is ${lim}.`,
      zh: `AI 服務冇提供 token 數目,所以以下係估算:輸入約 ${inp} 個 token(你嘅問題同球會資料),被截斷前已寫出約 ${out} 個輸出 token。輸出上限係 ${lim}。`,
    };
  }
  if (t.outputTokens >= t.limit) {
    return {
      en: `The AI used its whole output limit of ${lim} tokens and still had more to write, so the complete answer needs more than ${lim} output tokens. Your question and the club data used ${inp} input tokens.`,
      zh: `AI 已用盡全部 ${lim} 個輸出 token 上限,仲有內容未寫完,所以完整回答需要超過 ${lim} 個輸出 token。你嘅問題同球會資料用咗 ${inp} 個輸入 token。`,
    };
  }
  return {
    en: `The service reported ${out} output tokens against a limit of ${lim}, yet stopped for length (some services count hidden reasoning separately). Your question and the club data used ${inp} input tokens.`,
    zh: `服務回報輸出 ${out} 個 token,上限係 ${lim},但仍然因長度而停止(有啲服務會另外計算隱藏嘅推理)。你嘅問題同球會資料用咗 ${inp} 個輸入 token。`,
  };
}
