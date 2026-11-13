// Builds the configured provider from environment variables. The fake provider is only chosen when
// LLM_PROVIDER=fake is set explicitly, so a missing key can never silently fall back to a demo.
import { readLlmConfig, type LlmConfig } from "./config";
import { createFakeProvider } from "./fake";
import { createOpenAiCompatible, type LlmProvider } from "./provider";

export type LlmSetup =
  | { configured: true; config: LlmConfig; provider: LlmProvider }
  | { configured: false; missing: string[]; problems: string[] };

/**
 * @param opts.maxTimeoutMs lowers LLM_TIMEOUT_MS (never raises it) for callers that have less time to spare.
 */
export function getLlm(env: Record<string, string | undefined> = process.env, opts: { maxTimeoutMs?: number } = {}): LlmSetup {
  const r = readLlmConfig(env);
  if (!r.configured) return r;
  const config = opts.maxTimeoutMs === undefined ? r.config : { ...r.config, timeoutMs: Math.min(r.config.timeoutMs, opts.maxTimeoutMs) };
  return { configured: true, config, provider: config.provider === "fake" ? createFakeProvider() : createOpenAiCompatible(config) };
}

/**
 * What the page may show about the provider: host and model, never the key or full URL. When not configured it
 * lists the NAMES of missing variables and the validation messages (which name a variable and a range, never a
 * value), so the owner can see what to fix. Variable names are public anyway (.env.example).
 */
export function describeProvider(env: Record<string, string | undefined> = process.env): { configured: false; missing: string[]; problems: string[] } | { configured: true; host: string; model: string; demo: boolean; userDailyLimit: number } {
  const r = readLlmConfig(env);
  if (!r.configured) return { configured: false, missing: r.missing, problems: r.problems };
  const c = r.config;
  return { configured: true, host: c.provider === "fake" ? "" : new URL(c.baseUrl).host, model: c.model, demo: c.provider === "fake", userDailyLimit: c.userDailyLimit };
}
