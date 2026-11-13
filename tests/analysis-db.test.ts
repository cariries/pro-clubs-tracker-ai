// The whole Ask AI flow with the REAL database code (the shared club cache, budget reservation, usage update) on an
// in-process Postgres built from the project's migrations. The first version of this test found real bugs, so keep
// it: unit tests with fakes cannot see SQL problems.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyze, type AnalyzeDeps } from "@/lib/llm/analyze";
import { readLlmConfig } from "@/lib/llm/config";
import { createFakeProvider } from "@/lib/llm/fake";
import { finalizeUsage, reserveBudget } from "@/lib/llm/usage";
import { loadClubsForAnalysis, type ClubCacheDeps } from "@/lib/club-cache";
import { readClubCache, writeClubCache } from "@/lib/club-cache-db";
import { captureClub } from "@/lib/club-capture";
import { PROFILE_PARTS } from "@/lib/public-data";
import { clubCache } from "@/db/schema";
import { baseEa, mockEa } from "./helpers";
import { makeDb } from "./pg";

let client: Awaited<ReturnType<typeof makeDb>>["client"];
let db: Awaited<ReturnType<typeof makeDb>>["db"];
let migrations: string[];

beforeAll(async () => {
  ({ client, db, migrations } = await makeDb());
});
beforeEach(async () => {
  await client.exec(`TRUNCATE "llm_usage"; TRUNCATE "club_cache"; DELETE FROM "user"; INSERT INTO "user" ("id") VALUES ('u1'), ('u2');`);
});

const T0 = new Date("2026-11-13T12:00:00.000Z");
const fakeCfg = () => {
  const r = readLlmConfig({ LLM_PROVIDER: "fake", CHAT_DAILY_CAP_USD: "5" });
  if (!r.configured) throw new Error("fake config should be valid");
  return r.config;
};
const REFS = [{ clubId: "914493", platform: "common-gen5" }, { clubId: "914493", platform: "nx" }];
const input = { clubs: REFS, question: "Which club defends best?", language: "zh" as const };

const state = { eaCalls: 0, now: T0, blocked: false };
beforeEach(() => { state.eaCalls = 0; state.now = T0; state.blocked = false; });

/** Cache deps on the REAL tables; only EA, the gate and the clock are fakes. */
const cacheDeps = (over: Partial<ClubCacheDeps> = {}): ClubCacheDeps => ({
  read: (c, p) => readClubCache(c, p, db as never),
  write: (c, p, cap, at) => writeClubCache(c, p, cap, at, db as never),
  admit: async () => ({ ok: true }),
  capture: async (c, p) => {
    state.eaCalls++;
    const cap = await captureClub(c, p, { fetchEa: mockEa(baseEa()) as never }, state.now, PROFILE_PARTS);
    return state.blocked ? { ...cap, blocked: true } : cap;
  },
  openBreaker: async () => {},
  now: () => state.now,
  ...over,
});

const realDeps = (over: Partial<AnalyzeDeps> = {}, cache: Partial<ClubCacheDeps> = {}): AnalyzeDeps => ({
  config: fakeCfg(),
  provider: createFakeProvider(),
  loadClubs: (_u, refs) => loadClubsForAnalysis(cacheDeps(cache), refs),
  reserve: (p) => reserveBudget(p, db as never),
  finalize: (id, v) => finalizeUsage(id, v, db as never),
  ...over,
});
const usageRows = async () => (await client.query<any>(`SELECT * FROM "llm_usage" ORDER BY "createdAt"`)).rows;
const cacheRows = async () => (await client.query<any>(`SELECT "clubId", "platform", (EXTRACT(EPOCH FROM "fetchedAt") * 1000)::bigint AS ms FROM "club_cache" ORDER BY "platform"`)).rows;

describe("test database", () => {
  it("is built from every migration file, including the club cache", async () => {
    expect(migrations.length).toBeGreaterThanOrEqual(4);
    expect((await client.query<any>(`SELECT to_regclass('public.club_cache') AS t`)).rows[0].t).toBe("club_cache");
  });
});

describe("the shared club cache on real SQL", () => {
  it("stores one row per club and platform, and a second write overwrites it in place", async () => {
    const cap = await captureClub("914493", "common-gen5", { fetchEa: mockEa(baseEa()) as never }, T0, PROFILE_PARTS);
    await writeClubCache("914493", "common-gen5", cap, T0, db as never);
    await writeClubCache("914493", "common-gen5", cap, new Date(T0.getTime() + 60_000), db as never);
    await writeClubCache("914493", "nx", cap, T0, db as never);
    const rows = await cacheRows();
    expect(rows.map((r: any) => r.platform)).toEqual(["common-gen5", "nx"]); // 2 rows, not 3
    expect(Number(rows[0].ms)).toBe(T0.getTime() + 60_000);
  });

  it("reads back what was written, with the time it was fetched", async () => {
    const cap = await captureClub("914493", "common-gen5", { fetchEa: mockEa(baseEa()) as never }, T0, PROFILE_PARTS);
    await writeClubCache("914493", "common-gen5", cap, T0, db as never);
    const got = await readClubCache("914493", "common-gen5", db as never);
    expect(got?.fetchedAt.getTime()).toBe(T0.getTime());
    expect(got?.capture.summary.clubName).toBe("Test 1 team");
    expect(got?.capture.payload.parts.memberStats.status).toBe("ok");
    expect(await readClubCache("1", "nx", db as never)).toBeNull();
  });

  it("an unusable stored row counts as a miss, never an error", async () => {
    for (const data of [5, "x", [], {}, { payload: {} }, { payload: {}, summary: {} }, { payload: {}, summary: { statuses: { clubInfo: 1 } } }]) {
      await db.delete(clubCache);
      await db.insert(clubCache).values({ clubId: "1", platform: "nx", data: data as never });
      expect(await readClubCache("1", "nx", db as never), JSON.stringify(data)).toBeNull();
    }
  });

  it("holds nothing about any user (no user column)", async () => {
    const cols = (await client.query<any>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'club_cache' ORDER BY column_name`)).rows.map((r: any) => r.column_name);
    expect(cols).toEqual(["clubId", "data", "fetchedAt", "platform"]);
  });
});

describe("analyze with the real database", () => {
  it("fetches from EA on the first question, writes the cache, and reserves and finalises the cost", async () => {
    const r = await analyze(realDeps(), "u1", input);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.clubsUsed).toBe(2);
    expect(r.fetchedFromEa).toBe(2);
    expect(state.eaCalls).toBe(2);
    expect(await cacheRows()).toHaveLength(2);
    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "u1", provider: "fake", model: "demo", status: "ok", estimated: false });
  });

  it("a second question within 15 minutes, by a DIFFERENT user, uses the cache and makes no EA call", async () => {
    await analyze(realDeps(), "u1", input);
    expect(state.eaCalls).toBe(2);
    state.now = new Date(T0.getTime() + 14 * 60_000);
    const r = await analyze(realDeps(), "u2", input);
    expect(r.ok && r.fetchedFromEa).toBe(0);
    expect(state.eaCalls).toBe(2); // unchanged: shared across users
  });

  it("after 15 minutes the club is fetched again and the cache row is overwritten", async () => {
    await analyze(realDeps(), "u1", { ...input, clubs: [REFS[0]] });
    state.now = new Date(T0.getTime() + 16 * 60_000);
    const r = await analyze(realDeps(), "u2", { ...input, clubs: [REFS[0]] });
    expect(r.ok && r.fetchedFromEa).toBe(1);
    expect(state.eaCalls).toBe(2);
    const rows = await cacheRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].ms)).toBe(state.now.getTime());
  });

  it("works for ONE club (its own statistics and members)", async () => {
    const r = await analyze(realDeps(), "u1", { ...input, clubs: [REFS[0]] });
    expect(r.ok && r.comparison.mode).toBe("single");
    expect(r.ok && r.comparison.clubs[0].members.length).toBeGreaterThan(0);
  });

  it("a block from EA writes no cache row, no usage row, and the model is never called", async () => {
    state.blocked = true;
    let called = 0;
    const d = realDeps({ provider: { name: "p", complete: async () => { called++; throw new Error("no"); } } });
    expect(await analyze(d, "u1", input)).toMatchObject({ ok: false, error: "upstream_blocked", status: 503 });
    expect(called).toBe(0);
    expect(await cacheRows()).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  it("a refused gate still serves clubs that are already cached", async () => {
    await analyze(realDeps(), "u1", input);
    const d = realDeps({}, { admit: async () => ({ ok: false, reason: "breaker", retryAfterSec: 200 }) });
    expect((await analyze(d, "u2", input)).ok).toBe(true);
  });

  it("counts every attempt against the per-user daily limit", async () => {
    const d = realDeps();
    d.config = { ...d.config, userDailyLimit: 2 };
    expect((await analyze(d, "u1", input)).ok).toBe(true);
    expect((await analyze(d, "u1", input)).ok).toBe(true);
    expect(await analyze(d, "u1", input)).toMatchObject({ ok: false, error: "budget", status: 429 });
    expect(await usageRows()).toHaveLength(2);
    expect((await analyze(d, "u2", input)).ok).toBe(true); // another user is unaffected
  });

  it("records a failed provider call as 'failed' with an estimated input cost", async () => {
    const { LlmError } = await import("@/lib/llm/provider");
    const d = realDeps({ provider: { name: "f", complete: async () => { throw new LlmError("timeout", "t"); } } });
    d.config = { ...d.config, inPriceUsdPerMTok: 100, outPriceUsdPerMTok: 100 };
    expect(await analyze(d, "u1", input)).toMatchObject({ ok: false, error: "llm_failed" });
    const [row] = await usageRows();
    expect(row).toMatchObject({ status: "failed", estimated: true, outputTokens: null });
    expect(row.costMicroUsd).toBeGreaterThan(0);
  });

  it("records invalid model output as 'invalid' and still bills it", async () => {
    const d = realDeps({ provider: { name: "j", complete: async () => ({ text: "nope", usage: { inputTokens: 500, outputTokens: 10 }, truncated: false }) } });
    d.config = { ...d.config, inPriceUsdPerMTok: 1, outPriceUsdPerMTok: 1 };
    expect(await analyze(d, "u1", input)).toMatchObject({ ok: false, error: "llm_invalid_output" });
    const [row] = await usageRows();
    expect(row).toMatchObject({ status: "invalid", inputTokens: 500, outputTokens: 10, estimated: false });
    expect(row.costMicroUsd).toBe(510); // (500 + 10) tokens at $1 per million tokens
  });
});

describe("a user that does not exist", () => {
  it("the ledger's foreign key still rejects a reservation for a missing user (a missing user row would 500)", async () => {
    await expect(reserveBudget({ userId: "ghost-user", provider: "p", model: "m", estMicroUsd: 1, capMicroUsd: 1000, userLimit: 5 }, db as never)).rejects.toThrow();
  });
});
