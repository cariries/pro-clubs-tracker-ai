// Pure cost and budget arithmetic. No database, no network.

/**
 * Rough token estimate. No real tokenizer is available here, so this is deliberately conservative
 * (over-counts): about 3 ASCII characters per token and 2 tokens per non-ASCII character (Chinese). Real
 * counts differ by provider; the provider's reported usage replaces this after the call.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3 + other * 2);
}

export function costUsd(inputTokens: number, outputTokens: number, inPricePerMTok: number, outPricePerMTok: number): number {
  return (inputTokens * inPricePerMTok + outputTokens * outPricePerMTok) / 1_000_000;
}

export type BudgetDecision = { ok: true } | { ok: false; reason: "daily_cap" | "user_daily_limit" };

export function decideBudget(p: {
  spentTodayUsd: number;
  estCostUsd: number;
  capUsd: number;
  userCallsToday: number;
  userLimit: number;
}): BudgetDecision {
  if (p.userCallsToday >= p.userLimit) return { ok: false, reason: "user_daily_limit" };
  // Compare the worst case for THIS call too, so one call can't blow far past the cap.
  if (p.spentTodayUsd + p.estCostUsd > p.capUsd) return { ok: false, reason: "daily_cap" };
  return { ok: true };
}
