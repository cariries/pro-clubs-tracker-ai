// The Ask AI conversation as the BROWSER keeps it (nothing is stored on the server per user). Pure functions, so the
// rules are testable: what is sent back as history, the turn limit, and the sessionStorage format. sessionStorage is
// the user's own tab, but it is still read defensively (it can be cleared, edited or from an older version).
import { ANSWER_SUMMARY_MAX_CHARS, cleanHistoryText, type HistoryTurn } from "./llm/history";

export interface ThreadTurn {
  question: string;
  /** Short plain-text summary of the answer (from the server's `answerSummary`). This is what is sent back as history. */
  summary: string;
}

export interface StoredThread {
  v: 1;
  language: "en" | "zh";
  turns: ThreadTurn[];
}

/** The key is the chosen clubs, so a different set of clubs is a different (empty) conversation. */
export const threadKey = (clubsValue: string): string => `ask-thread:${clubsValue}`;

/** What to send with the next question. */
export const historyOf = (turns: readonly ThreadTurn[]): HistoryTurn[] => turns.map((t) => ({ question: t.question, answer: t.summary }));

export const turnsLeft = (turns: number, maxTurns: number): number => Math.max(0, maxTurns - turns);
export const threadFull = (turns: number, maxTurns: number): boolean => turns >= maxTurns;

/** Adds a finished turn. Returns a new list; never more than maxTurns. */
export function appendTurn(turns: readonly ThreadTurn[], turn: ThreadTurn, maxTurns: number): ThreadTurn[] {
  return [...turns, { question: turn.question, summary: turn.summary }].slice(-maxTurns);
}

export function serializeThread(language: "en" | "zh", turns: readonly ThreadTurn[]): string {
  const stored: StoredThread = { v: 1, language, turns: turns.map((t) => ({ question: t.question, summary: t.summary })) };
  return JSON.stringify(stored);
}

/** Reads a stored thread. Anything unexpected gives null (start a fresh conversation); never throws. */
export function parseStoredThread(raw: string | null | undefined, maxTurns: number): StoredThread | null {
  if (!raw || raw.length > 200_000) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const { v, language, turns } = o as Record<string, unknown>;
  if (v !== 1 || (language !== "en" && language !== "zh") || !Array.isArray(turns)) return null;
  const out: ThreadTurn[] = [];
  for (const t of turns.slice(0, maxTurns)) {
    if (typeof t !== "object" || t === null) return null;
    const { question, summary } = t as Record<string, unknown>;
    if (typeof question !== "string" || typeof summary !== "string") return null;
    const q = cleanHistoryText(question, 500);
    if (q === "") return null;
    out.push({ question: q, summary: cleanHistoryText(summary, ANSWER_SUMMARY_MAX_CHARS) });
  }
  return { v: 1, language, turns: out };
}
