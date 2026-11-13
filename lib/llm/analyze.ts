// Orchestrates one analysis: validate -> load each chosen club (shared 15-minute cache, else live EA) -> deterministic
// cross-club comparison -> digest -> budget reservation -> model call -> strict validation -> usage bookkeeping.
// Every outside effect (club data, database, provider) is a dependency, so the whole flow is testable with fakes.
import { compareClubs, MAX_CLUBS, MIN_CLUBS, type ClubComparison, type ClubInput } from "../club-compare";
import type { TruncationTokens } from "../analysis-ui";
import { isClubId, isPublicPlatform } from "../public-clubs";
import { costUsd, estimateTokens } from "./budget";
import type { LlmConfig } from "./config";
import { buildDigest, buildPrompt, QUESTION_MAX_CHARS, type Language } from "./prompt";
import { LlmError, type LlmProvider } from "./provider";
import { parseReport, type Report } from "./report";
import { toMicro, type ReserveResult } from "./usage";

/** `llm_usage.costMicroUsd` is a 32-bit integer; stay well inside it (about 2,000 USD in one call). */
export const MAX_SINGLE_CALL_MICRO_USD = 2_000_000_000;

export interface ClubRef {
  clubId: string;
  platform: string;
}

export interface AnalysisInput {
  /** 1 to 4 clubs the user picked (club id + platform). */
  clubs: ClubRef[];
  question: string;
  language: Language;
}

export type InputValidation = { ok: true; value: AnalysisInput } | { ok: false; error: string };

export function validateAnalysisInput(body: unknown): InputValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const { clubs, question, language } = body as Record<string, unknown>;
  if (!Array.isArray(clubs)) return { ok: false, error: "clubs must be a list of 1 to 4 clubs" };
  const seen = new Set<string>();
  const refs: ClubRef[] = [];
  for (const c of clubs) {
    const o = typeof c === "object" && c !== null ? (c as Record<string, unknown>) : null;
    if (!o || !isClubId(o.clubId) || !isPublicPlatform(o.platform)) return { ok: false, error: "each club needs a numeric clubId and a platform (common-gen5 or nx)" };
    const key = `${o.clubId}:${o.platform}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ clubId: o.clubId, platform: o.platform });
    }
  }
  if (refs.length < MIN_CLUBS) return { ok: false, error: `choose at least ${MIN_CLUBS} club` };
  if (refs.length > MAX_CLUBS) return { ok: false, error: `choose at most ${MAX_CLUBS} clubs` };
  if (typeof question !== "string") return { ok: false, error: "question must be a string" };
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length < 1 || q.length > QUESTION_MAX_CHARS) return { ok: false, error: `question must be 1 to ${QUESTION_MAX_CHARS} characters` };
  if (language !== "en" && language !== "zh") return { ok: false, error: 'language must be "en" or "zh"' };
  return { ok: true, value: { clubs: refs, question: q, language } };
}

/** Why loading a club's data failed. `refused` = our own limits (try again soon); the others are about EA. */
export type LoadFailure = { ok: false; error: "refused" | "blocked" | "ea_error" | "not_found" | "too_large"; retryAfterSec?: number; clubId?: string };

export interface AnalyzeDeps {
  config: LlmConfig;
  provider: LlmProvider;
  /**
   * Loads the chosen clubs: from the shared 15-minute cache when fresh, otherwise live from EA (gated by the
   * shared limits). Returns the data in the order asked, or the first failure. Nothing is stored per user.
   */
  loadClubs(userId: string, refs: ClubRef[]): Promise<{ ok: true; clubs: ClubInput[]; fetchedFromEa: number } | LoadFailure>;
  reserve(p: { userId: string; provider: string; model: string; estMicroUsd: number; capMicroUsd: number; userLimit: number }): Promise<ReserveResult>;
  /** Called when the model's answer hit the output-token limit, so the server can log how close to the limit it was. Never sent to the browser. */
  onTruncated?(info: { outputTokens: number; limit: number; estimated: boolean; inputTokens: number }): void;
  /** Called when the provider call fails, so the server can log WHY (status and the provider's sentence). Never sent to the browser. */
  onLlmError?(info: { kind: string; status?: number; attempts: number; detail?: string }): void;
  finalize(id: string, v: { status: "ok" | "failed" | "invalid"; inputTokens: number | null; outputTokens: number | null; estimated: boolean; costMicroUsd: number }): Promise<void>;
}

export type AnalyzeFailure =
  | "club_not_found"
  | "upstream_blocked"
  | "ea_error"
  | "busy"
  | "too_large"
  | "budget"
  | "cost_exceeds_cap"
  | "llm_failed"
  | "llm_invalid_output"
  | "llm_truncated";

export type AnalyzeResult =
  | { ok: true; report: Report; comparison: ClubComparison; clubsUsed: number; fetchedFromEa: number; usage: { inputTokens: number; outputTokens: number; costUsd: number; estimated: boolean; attempts: number } }
  | { ok: false; error: AnalyzeFailure; message: string; status: number; tokens?: TruncationTokens };

const fail = (error: AnalyzeFailure, message: string, status: number, tokens?: TruncationTokens): AnalyzeResult => ({ ok: false, error, message, status, ...(tokens ? { tokens } : {}) });

export async function analyze(deps: AnalyzeDeps, userId: string, input: AnalysisInput): Promise<AnalyzeResult> {
  const { config } = deps;

  // 1. Get each club's data: shared cache first, live EA only when it is missing or older than 15 minutes.
  const loaded = await deps.loadClubs(userId, input.clubs);
  if (!loaded.ok) {
    switch (loaded.error) {
      case "refused":
        return fail("busy", "Too many requests right now. Please wait a moment and try again.", 429);
      case "blocked":
        return fail("upstream_blocked", "EA appears to be blocking requests, so nothing was analysed. Try again later.", 503);
      case "not_found":
        return fail("club_not_found", "EA has no club with that ID on that platform.", 404);
      case "too_large":
        return fail("too_large", "These clubs hold too much data to analyse at once. Try fewer clubs.", 413);
      default:
        return fail("ea_error", "EA did not respond properly. Please try again in a moment.", 502);
    }
  }
  const comparison = compareClubs(loaded.clubs);

  // Fit the digest to the input budget: full -> trimmed -> refuse. Never silently send a truncated string.
  let prompt = buildPrompt(buildDigest(comparison), input.question, input.language);
  let inputEst = estimateTokens(prompt.system) + estimateTokens(prompt.user);
  if (inputEst > config.maxInputTokens) {
    prompt = buildPrompt(buildDigest(comparison, 3, 6), input.question, input.language);
    inputEst = estimateTokens(prompt.system) + estimateTokens(prompt.user);
  }
  if (inputEst > config.maxInputTokens) return fail("too_large", "These clubs hold too much data to analyse at once. Try fewer clubs.", 413);

  const worstCase = costUsd(inputEst, config.maxOutputTokens, config.inPriceUsdPerMTok, config.outPriceUsdPerMTok);
  const estMicroUsd = toMicro(worstCase);
  const capMicroUsd = toMicro(config.dailyCapUsd);
  // If even ONE call's worst case cannot fit under the daily cap (or the ledger's integer column), no call
  // can ever succeed: that is a price or limit misconfiguration. Say so instead of letting the database throw.
  if (estMicroUsd > capMicroUsd || estMicroUsd > MAX_SINGLE_CALL_MICRO_USD) {
    return fail("cost_exceeds_cap", "One analysis could cost more than the daily cap. Check the LLM price and token-limit settings.", 503);
  }
  const reservation = await deps.reserve({
    userId,
    provider: config.provider,
    model: config.model,
    estMicroUsd,
    capMicroUsd,
    userLimit: config.userDailyLimit,
  });
  if (!reservation.ok) return fail("budget", "The daily analysis limit has been reached. Please try again tomorrow.", 429);

  let completion;
  try {
    completion = await deps.provider.complete({ system: prompt.system, user: prompt.user, maxOutputTokens: config.maxOutputTokens });
  } catch (err) {
    // The call may still have been billed (a timeout, for one). Keep the INPUT estimate as the cost: a
    // middle path between zero and the full worst case. Documented in CLAUDE.md.
    await deps.finalize(reservation.id, {
      status: "failed",
      inputTokens: inputEst,
      outputTokens: null,
      estimated: true,
      costMicroUsd: toMicro(costUsd(inputEst, 0, config.inPriceUsdPerMTok, config.outPriceUsdPerMTok)),
    });
    const kind = err instanceof LlmError ? err.kind : "network";
    deps.onLlmError?.({ kind, status: err instanceof LlmError ? err.status : undefined, attempts: err instanceof LlmError ? err.attempts : 1, detail: err instanceof LlmError ? err.detail : undefined });
    return fail("llm_failed", kind === "timeout" ? "The AI service timed out. Please try again." : "The AI service is unavailable. Please try again later.", 502);
  }

  const inTok = completion.usage?.inputTokens ?? inputEst;
  const outTok = completion.usage?.outputTokens ?? estimateTokens(completion.text);
  const estimated = completion.usage === null;
  const actualUsd = costUsd(inTok, outTok, config.inPriceUsdPerMTok, config.outPriceUsdPerMTok);

  const parsed = parseReport(completion.text, input.language);
  await deps.finalize(reservation.id, {
    status: parsed.ok && !completion.truncated ? "ok" : "invalid",
    inputTokens: inTok,
    outputTokens: outTok,
    estimated,
    costMicroUsd: toMicro(actualUsd),
  });

  if (completion.truncated) {
    deps.onTruncated?.({ outputTokens: outTok, limit: config.maxOutputTokens, estimated, inputTokens: inTok });
    return fail("llm_truncated", "The AI answer hit the length limit and was cut off. Try a narrower question, or ask the site owner to raise the output limit.", 502, {
      inputTokens: inTok,
      outputTokens: outTok,
      limit: config.maxOutputTokens,
      estimated,
    });
  }
  if (!parsed.ok) return fail("llm_invalid_output", "The AI returned an answer in an unexpected format. Please try again.", 502);

  return { ok: true, report: parsed.report, comparison, clubsUsed: loaded.clubs.length, fetchedFromEa: loaded.fetchedFromEa, usage: { inputTokens: inTok, outputTokens: outTok, costUsd: actualUsd, estimated, attempts: completion.attempts ?? 1 } };
}
