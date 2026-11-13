// Provider interface plus one adapter for "OpenAI-compatible" chat-completions endpoints. Many providers
// offer that shape, but whether a specific one does, and its exact base URL and model names, must be
// checked on that provider's own docs: nothing is assumed here. No SDK, no new dependency.
import type { LlmConfig } from "./config";

export interface CompletionRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface CompletionResult {
  text: string;
  /** Provider-reported token counts, or null if the response had none. */
  usage: { inputTokens: number; outputTokens: number } | null;
  /** True if the provider said it stopped because of the output token limit (JSON is probably cut off). */
  truncated: boolean;
  /** How many requests were sent (1 = no retry). Absent for providers that do not retry. */
  attempts?: number;
}

export type LlmErrorKind = "timeout" | "network" | "http" | "bad_response";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  /** Seconds the provider asked us to wait (Retry-After), in ms. */
  readonly retryAfterMs?: number;
  /**
   * The provider's own error sentence (first 200 characters, one line). FOR SERVER LOGS ONLY: it is
   * provider-written text, so it is never part of `message` and must never be sent to the browser.
   */
  readonly detail?: string;
  /** Requests sent before giving up. Set by the retry loop. */
  attempts = 1;

  constructor(kind: LlmErrorKind, message: string, status?: number, extra: { retryAfterMs?: number; detail?: string } = {}) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = extra.retryAfterMs;
    this.detail = extra.detail;
  }
}

export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** Injected in tests so retries need no real waiting. */
export interface ProviderDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// Retried because the request very probably produced no output (and so no charge): the provider is busy or
// the connection failed. A TIMEOUT is deliberately never retried: the provider may still be generating, and
// may bill, so a second attempt could double the cost.
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const BASE_DELAY_MS = 400;
/** If the provider asks us to wait longer than this, give up instead of holding the request open. */
const MAX_RETRY_AFTER_MS = 10_000;
/** A retry must leave at least this much of the total deadline, or it cannot finish anyway. */
const MIN_ATTEMPT_MS = 3_000;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRetryable(err: LlmError): boolean {
  if (err.kind === "network") return true;
  return err.kind === "http" && err.status !== undefined && RETRY_STATUS.has(err.status);
}

/** Retry-After as milliseconds: either seconds or an HTTP date. Undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  // An HTTP date looks like "Wed, 21 Oct 2026 07:28:00 GMT". Date.parse is far too forgiving on its own
  // ("-3" parses as a date in 2001), so require day/month letters and a four-digit year first.
  if (!/[A-Za-z]{3}/.test(v) || !/\b\d{4}\b/.test(v)) return undefined;
  const date = Date.parse(v);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

/** Pulls the provider's error sentence out of a failed response. Handles `{error:{message}}` and the array form Gemini uses. */
async function readErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    let message: string | undefined;
    try {
      const json: unknown = JSON.parse(text);
      const first = Array.isArray(json) ? json[0] : json;
      if (isObj(first)) {
        if (isObj(first.error) && typeof first.error.message === "string") message = first.error.message;
        else if (typeof first.message === "string") message = first.message;
      }
    } catch {
      /* not JSON: fall back to the raw text */
    }
    const out = (message ?? text).replace(/\s+/g, " ").trim().slice(0, 200);
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

export function createOpenAiCompatible(cfg: LlmConfig, fetchImpl: typeof fetch = fetch, deps: ProviderDeps = {}): LlmProvider {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  /** One HTTP request. `budgetMs` is how long this attempt may take. */
  async function attemptOnce(req: CompletionRequest, budgetMs: number): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxOutputTokens,
      temperature: 0.2,
    };
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;
    if (cfg.jsonMode) body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, budgetMs)),
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";
      throw new LlmError(timedOut ? "timeout" : "network", timedOut ? "LLM request timed out" : "LLM request failed");
    }

    if (!res.ok) {
      // The message stays generic. The provider's own sentence goes in `detail`, for server logs only.
      throw new LlmError("http", `LLM provider returned HTTP ${res.status}`, res.status, {
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), now()),
        detail: await readErrorDetail(res),
      });
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new LlmError("bad_response", "LLM response was not JSON");
    }
    const choice = isObj(json) && Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : null;
    const content = choice && isObj(choice.message) ? choice.message.content : undefined;
    if (typeof content !== "string" || content.trim() === "") {
      throw new LlmError("bad_response", "LLM response had no message content");
    }
    const u = isObj(json) && isObj(json.usage) ? json.usage : null;
    const pt = u && typeof u.prompt_tokens === "number" ? u.prompt_tokens : null;
    const ct = u && typeof u.completion_tokens === "number" ? u.completion_tokens : null;
    return {
      text: content,
      usage: pt !== null && ct !== null && Number.isFinite(pt) && Number.isFinite(ct) ? { inputTokens: pt, outputTokens: ct } : null,
      truncated: choice?.finish_reason === "length",
    };
  }

  return {
    name: "openai-compatible",
    async complete(req) {
      const started = now();
      for (let attempt = 1; ; attempt++) {
        const remaining = cfg.timeoutMs - (now() - started);
        try {
          return { ...(await attemptOnce(req, remaining)), attempts: attempt };
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          err.attempts = attempt;
          if (!isRetryable(err) || attempt > cfg.maxRetries) throw err;

          // Wait the longer of our backoff and what the provider asked, but only if the whole thing still
          // fits in the deadline with room for a real attempt.
          if (err.retryAfterMs !== undefined && err.retryAfterMs > MAX_RETRY_AFTER_MS) throw err;
          const wait = Math.max(BASE_DELAY_MS * 2 ** (attempt - 1), err.retryAfterMs ?? 0);
          if (cfg.timeoutMs - (now() - started) - wait < MIN_ATTEMPT_MS) throw err;
          await sleep(wait);
        }
      }
    },
  };
}
