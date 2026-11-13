import { fetchEa } from "@/lib/ea-fetch";
import { admitPublic, clientKey } from "@/lib/public-limit";
import { openBreaker, realGate } from "@/lib/public-db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const CACHE_SECONDS = 60;

// Live proxy to EA's Pro Clubs API. Public (no login). Stores nothing. One upstream request per call, no retries.
// It shares the public pages' protection: a per-visitor limit, a global ceiling on EA calls, and a circuit breaker
// that pauses calls when EA looks blocked. If the database is not configured the old in-memory limiter is the fallback.
export async function GET(req: Request, { params }: { params: Promise<{ endpoint: string }> }) {
  const { endpoint } = await params;
  const { searchParams } = new URL(req.url);
  const visitor = clientKey(req.headers);

  if (process.env.DATABASE_URL) {
    const gate = await admitPublic(realGate(), visitor, 1);
    if (!gate.ok) {
      return Response.json(
        { error: gate.reason === "breaker" ? "upstream_paused" : "rate_limited" },
        { status: gate.reason === "breaker" ? 503 : 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
      );
    }
  } else {
    const rl = rateLimit(visitor);
    if (!rl.ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  const result = await fetchEa(endpoint, searchParams, { revalidate: CACHE_SECONDS });
  if (!result.ok) {
    // A block pauses every public EA call for a few minutes so we do not keep hitting a server that is refusing us.
    if (result.kind === "blocked" && process.env.DATABASE_URL) await openBreaker();
    return Response.json(result.body, { status: result.status });
  }

  // Parsed (numbers as numbers) plus EA's untouched payload. Raw stays while field meanings are still
  // being learned; if a parser throws, `parsed` is null and `parseError` says why.
  return Response.json(
    { endpoint, parsed: result.parsed, parseError: result.parseError, raw: result.data },
    { headers: { "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}` } },
  );
}

