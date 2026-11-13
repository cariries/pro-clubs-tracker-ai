// Follow-up questions in one conversation. The BROWSER keeps the thread (nothing is stored per user) and sends the
// earlier turns with each new question, so this module treats every earlier turn as UNTRUSTED text: it checks the
// shape, caps the count and the length, and strips anything that could forge the prompt's delimiters. Earlier answers
// are context for the model's wording only; the numbers always come from the freshly loaded digest, never from history.
// (The question length limit is repeated here on purpose, not imported from prompt.ts, which imports this file.)
const QUESTION_MAX_CHARS = 500;

/** Default and bounds for the per-conversation turn limit (env LLM_MAX_TURNS). A "turn" is one question and its answer. */
export const DEFAULT_MAX_TURNS = 8;
export const MIN_MAX_TURNS = 1;
export const MAX_MAX_TURNS = 30;
/** An earlier answer is reduced to this many characters before it is sent again, so history cannot grow without bound. */
export const ANSWER_SUMMARY_MAX_CHARS = 700;

export interface HistoryTurn {
  /** What the user asked. */
  question: string;
  /** A short plain-text summary of the answer (the headline and the first lines), never the whole report. */
  answer: string;
}

export type HistoryValidation = { ok: true; turns: HistoryTurn[] } | { ok: false; error: string };

/** Removes control characters and anything shaped like our prompt tags, so history cannot close or open a block. */
export function cleanHistoryText(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    // any angle-bracket tag at all (spaces allowed inside, so "< /user_question >" is caught too), then stray brackets
    .replace(/<[^>]*>?/g, " ")
    .replace(/[<>]/g, "")
    // the prompt's own section markers must not appear inside history, or a turn could pose as a second digest
    .replace(/Digest\s*\(JSON\)\s*:/gi, "Digest:")
    .replace(/Requested\s+language\s*:/gi, "Language:")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * @param raw       the `history` field of the request body (anything)
 * @param maxTurns  the configured limit; the NEW question must still fit, so at most maxTurns - 1 earlier turns are allowed
 */
export function validateHistory(raw: unknown, maxTurns: number): HistoryValidation {
  if (raw === undefined || raw === null) return { ok: true, turns: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "history must be a list" };
  if (raw.length > maxTurns - 1) return { ok: false, error: "turn_limit" };
  const turns: HistoryTurn[] = [];
  for (const t of raw) {
    if (typeof t !== "object" || t === null || Array.isArray(t)) return { ok: false, error: "each history turn must be an object" };
    const { question, answer } = t as Record<string, unknown>;
    if (typeof question !== "string" || typeof answer !== "string") return { ok: false, error: "each history turn needs a question and an answer (text)" };
    const q = cleanHistoryText(question, QUESTION_MAX_CHARS);
    const a = cleanHistoryText(answer, ANSWER_SUMMARY_MAX_CHARS);
    if (q === "") return { ok: false, error: "a history question is empty" };
    turns.push({ question: q, answer: a });
  }
  return { ok: true, turns };
}

/** The history as one delimited block for the prompt, oldest first. Empty string when there is none. */
export function historyBlock(turns: readonly HistoryTurn[]): string {
  if (turns.length === 0) return "";
  const lines = turns.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer === "" ? "(no summary)" : t.answer}`);
  return `<conversation_history>\n${lines.join("\n")}\n</conversation_history>`;
}

/** A short summary of a finished report, for the browser to keep and send back as history. */
export function summariseAnswer(report: { headline: string; sections: ReadonlyArray<{ items: readonly string[] }> }): string {
  const parts = [report.headline, ...report.sections.flatMap((s) => s.items).slice(0, 3)];
  return cleanHistoryText(parts.join(" "), ANSWER_SUMMARY_MAX_CHARS);
}

/** True when another question may still be asked in this conversation. */
export const canAskAnother = (turnsSoFar: number, maxTurns: number): boolean => turnsSoFar < maxTurns;
