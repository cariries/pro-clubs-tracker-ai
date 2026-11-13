// Reads the LLM settings from environment variables. Nothing about any provider is hardcoded: the
// endpoint, model name and prices all come from env, because we can't verify any provider's current
// URL, model names or pricing from here. Fails closed: a real provider without a daily cap and both
// prices is reported as NOT configured, so spending can never run unmetered.

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface LlmConfig {
  provider: "fake" | "openai-compatible";
  /** https base URL, no trailing slash. Empty for the fake provider. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** USD per 1,000,000 tokens, as quoted on the provider's pricing page. */
  inPriceUsdPerMTok: number;
  outPriceUsdPerMTok: number;
  /** Global spend cap per UTC day, in USD (CHAT_DAILY_CAP_USD). */
  dailyCapUsd: number;
  userDailyLimit: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  /** Total time allowed for one analysis call INCLUDING retries and waits between them (LLM_TIMEOUT_MS). */
  timeoutMs: number;
  /** Extra attempts after a quick failure (connection error, HTTP 408/429/5xx). 0 = never retry. */
  maxRetries: number;
  /** Sent as `reasoning_effort` when set; null = not sent. Support depends on the provider and model. */
  reasoningEffort: ReasoningEffort | null;
  /** Ask the provider for response_format json_object. Only some providers support it. */
  jsonMode: boolean;
}

export type LlmConfigResult =
  | { configured: true; config: LlmConfig }
  | { configured: false; missing: string[]; problems: string[] };

type Env = Record<string, string | undefined>;

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

function bounded(v: string | undefined, def: number, min: number, max: number, name: string, problems: string[]): number {
  if (v === undefined || v.trim() === "") return def;
  const n = num(v);
  if (n === null || !Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer from ${min} to ${max}`);
    return def;
  }
  return n;
}

export function readLlmConfig(env: Env): LlmConfigResult {
  const missing: string[] = [];
  const problems: string[] = [];
  const provider = (env.LLM_PROVIDER ?? "").trim();

  const maxOutputTokens = bounded(env.LLM_MAX_OUTPUT_TOKENS, 2000, 100, 8000, "LLM_MAX_OUTPUT_TOKENS", problems);
  const maxInputTokens = bounded(env.LLM_MAX_INPUT_TOKENS, 30000, 1000, 200000, "LLM_MAX_INPUT_TOKENS", problems);
  const userDailyLimit = bounded(env.LLM_USER_DAILY_LIMIT, 5, 1, 1000, "LLM_USER_DAILY_LIMIT", problems);
  const timeoutMs = bounded(env.LLM_TIMEOUT_MS, 45000, 1000, 55000, "LLM_TIMEOUT_MS", problems);
  const maxRetries = bounded(env.LLM_MAX_RETRIES, 1, 0, 3, "LLM_MAX_RETRIES", problems);

  // A typo here must be loud, not silently ignored, so an unknown value makes the service "not configured".
  let reasoningEffort: ReasoningEffort | null = null;
  const rawEffort = (env.LLM_REASONING_EFFORT ?? "").trim();
  if (rawEffort !== "") {
    if ((REASONING_EFFORTS as readonly string[]).includes(rawEffort)) reasoningEffort = rawEffort as ReasoningEffort;
    else problems.push(`LLM_REASONING_EFFORT must be one of: ${REASONING_EFFORTS.join(", ")}`);
  }

  if (provider === "fake") {
    if (problems.length > 0) return { configured: false, missing, problems };
    return {
      configured: true,
      config: {
        provider: "fake", baseUrl: "", apiKey: "", model: "demo",
        inPriceUsdPerMTok: 0, outPriceUsdPerMTok: 0,
        dailyCapUsd: num(env.CHAT_DAILY_CAP_USD) ?? 1,
        userDailyLimit, maxOutputTokens, maxInputTokens, timeoutMs, maxRetries: 0, reasoningEffort: null, jsonMode: false,
      },
    };
  }

  if (provider !== "openai-compatible") {
    missing.push("LLM_PROVIDER");
    if (provider !== "") problems.push('LLM_PROVIDER must be "openai-compatible" or "fake"');
    return { configured: false, missing, problems };
  }

  let baseUrl = "";
  const rawUrl = (env.LLM_BASE_URL ?? "").trim();
  if (rawUrl === "") missing.push("LLM_BASE_URL");
  else {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "https:") problems.push("LLM_BASE_URL must start with https://");
      else baseUrl = rawUrl.replace(/\/+$/, "");
    } catch {
      problems.push("LLM_BASE_URL is not a valid URL");
    }
  }

  const apiKey = (env.LLM_API_KEY ?? "").trim();
  if (apiKey === "") missing.push("LLM_API_KEY");
  const model = (env.LLM_MODEL ?? "").trim();
  if (model === "") missing.push("LLM_MODEL");

  const inPrice = num(env.LLM_INPUT_PRICE_PER_MTOK_USD);
  const outPrice = num(env.LLM_OUTPUT_PRICE_PER_MTOK_USD);
  if (env.LLM_INPUT_PRICE_PER_MTOK_USD === undefined || env.LLM_INPUT_PRICE_PER_MTOK_USD.trim() === "") missing.push("LLM_INPUT_PRICE_PER_MTOK_USD");
  else if (inPrice === null) problems.push("LLM_INPUT_PRICE_PER_MTOK_USD must be a non-negative number");
  if (env.LLM_OUTPUT_PRICE_PER_MTOK_USD === undefined || env.LLM_OUTPUT_PRICE_PER_MTOK_USD.trim() === "") missing.push("LLM_OUTPUT_PRICE_PER_MTOK_USD");
  else if (outPrice === null) problems.push("LLM_OUTPUT_PRICE_PER_MTOK_USD must be a non-negative number");

  const cap = num(env.CHAT_DAILY_CAP_USD);
  if (env.CHAT_DAILY_CAP_USD === undefined || env.CHAT_DAILY_CAP_USD.trim() === "") missing.push("CHAT_DAILY_CAP_USD");
  else if (cap === null || cap <= 0) problems.push("CHAT_DAILY_CAP_USD must be a number greater than 0");

  if (missing.length > 0 || problems.length > 0 || inPrice === null || outPrice === null || cap === null || cap <= 0) {
    return { configured: false, missing, problems };
  }
  return {
    configured: true,
    config: {
      provider: "openai-compatible", baseUrl, apiKey, model,
      inPriceUsdPerMTok: inPrice, outPriceUsdPerMTok: outPrice, dailyCapUsd: cap,
      userDailyLimit, maxOutputTokens, maxInputTokens, timeoutMs, maxRetries, reasoningEffort,
      jsonMode: (env.LLM_JSON_MODE ?? "").trim() === "1",
    },
  };
}
