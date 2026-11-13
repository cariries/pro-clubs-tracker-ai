// One upstream call to EA: validate against the allowlist, fetch once (no retries), detect block pages,
// parse. Shared by the public proxy route and club capture. Never retries or works around a block
// (see CLAUDE.md): a suspected block is reported as kind "blocked" and the caller must surface it.
import { BLOCK_PATTERN, buildEaUrl } from "./ea";
import { parseEaResponse } from "./ea-parse";

export type EaFailureKind = "bad_request" | "timeout" | "unreachable" | "blocked" | "upstream_error" | "not_json";

export type EaFetchResult =
  | { ok: true; endpoint: string; data: unknown; parsed: unknown; parseError: string | null }
  /** `status` and `body` are exactly what the proxy route returns to its caller. */
  | { ok: false; kind: EaFailureKind; status: number; body: Record<string, unknown> };

export interface EaFetchOptions {
  /** Seconds to let Next/Vercel cache the upstream response. Omit for a fresh (no-store) fetch. */
  revalidate?: number;
  timeoutMs?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
}

export async function fetchEa(
  endpoint: string,
  params: URLSearchParams,
  opts: EaFetchOptions = {},
): Promise<EaFetchResult> {
  const built = buildEaUrl(endpoint, params);
  if (!built.ok) {
    return { ok: false, kind: "bad_request", status: 400, body: { error: "bad_request", message: built.error } };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  let text: string;
  let res: Response;
  try {
    res = await doFetch(built.url, {
      headers: { Accept: "application/json", "User-Agent": "proclub-tracker/0.0.1" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      ...(opts.revalidate === undefined ? { cache: "no-store" as const } : { next: { revalidate: opts.revalidate } }),
    });
    text = await res.text();
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    return {
      ok: false,
      kind: timedOut ? "timeout" : "unreachable",
      status: 504,
      body: { error: "upstream_unreachable", message: timedOut ? "EA timed out" : "EA unreachable" },
    };
  }

  if (res.status === 403 || BLOCK_PATTERN.test(text.slice(0, 2000))) {
    return { ok: false, kind: "blocked", status: 503, body: { error: "upstream_blocked", upstreamStatus: res.status } };
  }
  if (!res.ok) {
    return { ok: false, kind: "upstream_error", status: 502, body: { error: "upstream_error", upstreamStatus: res.status } };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, kind: "not_json", status: 502, body: { error: "upstream_not_json" } };
  }
  const { parsed, parseError } = parseEaResponse(endpoint, data);
  return { ok: true, endpoint, data, parsed, parseError };
}
