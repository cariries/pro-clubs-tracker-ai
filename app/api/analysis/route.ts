import { auth, authConfigured } from "@/auth";
import { admitPublic } from "@/lib/public-limit";
import { openBreaker, realGate } from "@/lib/public-db";
import { describeUnexpected } from "@/lib/errors";
import { fetchEa } from "@/lib/ea-fetch";
import { getLlm } from "@/lib/llm";
import { analyze, validateAnalysisInput } from "@/lib/llm/analyze";
import { summariseAnswer } from "@/lib/llm/history";
import { finalizeUsage, reserveBudget } from "@/lib/llm/usage";
import { loadClubsForAnalysis, type ClubCacheDeps } from "@/lib/club-cache";
import { readClubCache, writeClubCache } from "@/lib/club-cache-db";
import { captureClub } from "@/lib/club-capture";
import { PROFILE_PARTS } from "@/lib/public-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to 4 clubs x 4 EA calls, then one model call. One minute is the Vercel Hobby ceiling.
export const maxDuration = 60;

/** Answer a question about 1 to 4 clubs, using the shared 15-minute club cache or live EA. */
export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    // Anything unexpected (database, driver, a bug). The browser gets a stable reference plus, for database
    // errors, the Postgres SQLSTATE code (a five-character class like 42P01, not sensitive). The real cause is
    // logged on ONE line under the same reference. SQL text and parameters are deliberately not logged.
    const ref = Date.now().toString(36);
    const info = describeUnexpected(err);
    console.error(`[analysis] unexpected error ref=${ref} code=${info.code ?? "none"} cause="${info.cause}" error="${info.summary}"`);
    return Response.json({ error: "internal_error", ref, code: info.code }, { status: 500 });
  }
}

async function handle(req: Request): Promise<Response> {
  if (!authConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  // The shared EA limits need the database; without it nothing can protect EA, so refuse rather than call it.
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request", message: "body must be JSON" }, { status: 400 });
  }
  // The turn limit comes from the LLM settings, so read them first.
  const llm = getLlm(process.env);
  if (!llm.configured) {
    // Which variables are missing goes to the server log, not to the browser.
    console.error("[analysis] LLM not configured. missing:", llm.missing.join(","), "problems:", llm.problems.join("; "));
    return Response.json({ error: "llm_not_configured" }, { status: 503 });
  }
  const input = validateAnalysisInput(body, llm.config.maxTurns);
  if (!input.ok) {
    // Too many earlier turns is the user's conversation being full, not a malformed request.
    if (input.error === "turn_limit") return Response.json({ error: "turn_limit", maxTurns: llm.config.maxTurns }, { status: 400 });
    return Response.json({ error: "bad_request", message: input.error }, { status: 400 });
  }

  // Live EA fetches use the SAME gate as the public pages, keyed by the signed-in user (not the shared IP), so one
  // user cannot use up everyone's allowance and a block pauses every EA call, public or not.
  const visitor = `user:${userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
  const gate = realGate();
  const cacheDeps: ClubCacheDeps = {
    read: (clubId, platform) => readClubCache(clubId, platform),
    write: (clubId, platform, cap, at) => writeClubCache(clubId, platform, cap, at),
    admit: (calls) => admitPublic(gate, visitor, calls),
    capture: (clubId, platform) => captureClub(clubId, platform, { fetchEa: (e, p) => fetchEa(e, p, { timeoutMs: 8_000 }) }, new Date(), PROFILE_PARTS),
    openBreaker: () => openBreaker(),
    now: () => new Date(),
  };

  const result = await analyze(
    {
      config: llm.config,
      provider: llm.provider,
      loadClubs: async (_u, refs) => loadClubsForAnalysis(cacheDeps, refs),
      reserve: reserveBudget,
      finalize: finalizeUsage,
      onTruncated: (e) =>
        console.error(`[analysis] answer cut off outputTokens=${e.outputTokens}${e.estimated ? "(estimated)" : ""} limit=${e.limit} inputTokens=${e.inputTokens}`),
      // The browser only ever sees a generic message. WHY it failed (a 401 bad key, 403 region or billing,
      // 404 unknown model, 400 unsupported setting) goes to the server log, on one line.
      onLlmError: (e) =>
        console.error(`[analysis] LLM call failed kind=${e.kind} status=${e.status ?? "none"} attempts=${e.attempts} detail=${JSON.stringify(e.detail ?? "")}`),
    },
    userId,
    input.value,
  );

  if (!result.ok) {
    return Response.json({ error: result.error, message: result.message, ...(result.tokens ? { tokens: result.tokens } : {}) }, { status: result.status });
  }
  const c = result.comparison;
  return Response.json({
    report: result.report,
    // A short plain-text summary the page keeps and sends back as history for follow-up questions.
    answerSummary: summariseAnswer(result.report),
    maxTurns: llm.config.maxTurns,
    // The numbers behind the report, computed by our code, so the page can show them next to the AI text.
    comparison: { mode: c.mode, clubs: c.clubs, metrics: c.metrics, playerBoards: c.playerBoards, samePlatform: c.samePlatform, usableClubs: c.usableClubs, warnings: c.warnings },
    fetchedFromEa: result.fetchedFromEa,
    usage: result.usage,
  });
}
