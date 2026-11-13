// "Refresh now": a live fetch that ignores the 15-minute window. The risk is EA load and a worse copy replacing a good one,
// so most tests count EA calls and check what is (not) written. EA, the clock, the gate and the database are fakes here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFRESH_MIN_AGE_SEC, REFRESH_PER_HOUR, refreshClubData, refreshClubs, type CacheRow, type RefreshDeps } from "@/lib/club-cache";
import { PART_KEYS, captureClub, type CaptureResult, type PartStatus } from "@/lib/club-capture";
import { PROFILE_PARTS } from "@/lib/public-data";
import { validateRefreshInput } from "@/lib/refresh-input";
import { baseEa, mockEa } from "./helpers";

const T0 = new Date("2026-11-14T12:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const real = () => captureClub("914493", "common-gen5", { fetchEa: mockEa(baseEa()) as never }, T0, PROFILE_PARTS);
const withStatuses = (cap: CaptureResult, over: Partial<Record<(typeof PART_KEYS)[number], PartStatus>>, extra: Partial<CaptureResult> = {}): CaptureResult => ({ ...cap, summary: { ...cap.summary, statuses: { ...cap.summary.statuses, ...over } }, ...extra });

async function harness(over: Partial<RefreshDeps> = {}, opts: { cachedAgeSec?: number | null; mine?: boolean } = {}) {
  const store = new Map<string, CacheRow>();
  if (opts.cachedAgeSec !== null && opts.cachedAgeSec !== undefined) store.set("914493:common-gen5", { capture: await real(), fetchedAt: at(-opts.cachedAgeSec) });
  const log = { captures: [] as string[], admits: [] as number[], writes: 0, consumed: 0, opened: 0 };
  const deps: RefreshDeps = {
    read: async (c, p) => store.get(`${c}:${p}`) ?? null,
    write: async (c, p, capture, fetchedAt) => { log.writes++; store.set(`${c}:${p}`, { capture, fetchedAt }); },
    admit: async (calls) => { log.admits.push(calls); return { ok: true }; },
    capture: async (c, p) => { log.captures.push(`${c}:${p}`); return real(); },
    openBreaker: async () => { log.opened++; },
    now: () => T0,
    consumeRefresh: async () => { log.consumed++; return opts.mine === false ? { ok: false, retryAfterSec: 1800 } : { ok: true, retryAfterSec: 0 }; },
    ...over,
  };
  return { deps, store, log };
}

describe("the limits", () => {
  it("at most once a minute per club, and 20 refreshes per user per hour", () => {
    expect(REFRESH_MIN_AGE_SEC).toBe(60);
    expect(REFRESH_PER_HOUR).toBe(20);
  });
});

describe("refreshClubData", () => {
  it("a club cached 10 minutes ago is fetched again (the 15-minute window is bypassed), stored for everyone, and says so", async () => {
    const h = await harness({}, { cachedAgeSec: 600 });
    const r = await refreshClubData(h.deps, "914493", "common-gen5");
    expect(r).toMatchObject({ result: "refreshed", fetchedAt: T0, clubName: "Test 1 team" });
    expect(h.log.captures).toEqual(["914493:common-gen5"]);
    expect(h.log.writes).toBe(1);
    expect(h.store.get("914493:common-gen5")!.fetchedAt).toEqual(T0);
  });
  it("works for a club that was never cached", async () => {
    const h = await harness({}, { cachedAgeSec: null });
    expect(await refreshClubData(h.deps, "914493", "common-gen5")).toMatchObject({ result: "refreshed" });
    expect(h.log.writes).toBe(1);
  });
  it("charges the shared EA gate the full price of a fetch (one unit per EA call) and this user's hourly allowance once", async () => {
    const h = await harness({}, { cachedAgeSec: 600 });
    await refreshClubData(h.deps, "914493", "common-gen5");
    expect(h.log.admits).toEqual([PROFILE_PARTS.length]);
    expect(h.log.consumed).toBe(1);
  });
  it("a copy fetched under a minute ago is NOT fetched again: no EA call, no gate charge, no allowance used", async () => {
    const h = await harness({}, { cachedAgeSec: 30 });
    const r = await refreshClubData(h.deps, "914493", "common-gen5");
    expect(r).toMatchObject({ result: "too_recent", retryAfterSec: 30 });
    expect(h.log.captures).toHaveLength(0);
    expect(h.log.admits).toHaveLength(0);
    expect(h.log.consumed).toBe(0);
    expect(h.log.writes).toBe(0);
  });
  it("exactly at the minimum age is allowed; one second earlier is not", async () => {
    expect((await refreshClubData((await harness({}, { cachedAgeSec: REFRESH_MIN_AGE_SEC })).deps, "914493", "common-gen5")).result).toBe("refreshed");
    expect((await refreshClubData((await harness({}, { cachedAgeSec: REFRESH_MIN_AGE_SEC - 1 })).deps, "914493", "common-gen5")).result).toBe("too_recent");
  });
  it("a cached time in the FUTURE (clock skew) counts as too recent, never as a free refresh", async () => {
    const h = await harness({}, { cachedAgeSec: -500 });
    const r = await refreshClubData(h.deps, "914493", "common-gen5");
    expect(r.result).toBe("too_recent");
    expect(h.log.captures).toHaveLength(0);
    if (r.result === "too_recent") expect(r.retryAfterSec).toBeLessThanOrEqual(REFRESH_MIN_AGE_SEC);
  });
  it("this user's hourly limit stops it BEFORE the shared gate and EA are touched, and the older copy stays", async () => {
    const h = await harness({}, { cachedAgeSec: 600, mine: false });
    const before = h.store.get("914493:common-gen5")!.fetchedAt;
    expect(await refreshClubData(h.deps, "914493", "common-gen5")).toMatchObject({ result: "limit", retryAfterSec: 1800, clubName: "Test 1 team" });
    expect(h.log.admits).toHaveLength(0);
    expect(h.log.captures).toHaveLength(0);
    expect(h.store.get("914493:common-gen5")!.fetchedAt).toEqual(before);
  });
  it("the shared EA ceiling or an open breaker stops it with no EA call", async () => {
    const h = await harness({ admit: async () => ({ ok: false, reason: "global", retryAfterSec: 20 }) }, { cachedAgeSec: 600 });
    expect(await refreshClubData(h.deps, "914493", "common-gen5")).toMatchObject({ result: "busy", retryAfterSec: 20 });
    expect(h.log.captures).toHaveLength(0);
    expect(h.log.writes).toBe(0);
  });
  it("a block opens the circuit breaker and stores nothing", async () => {
    const h = await harness({ capture: async () => ({ ...(await real()), blocked: true }) }, { cachedAgeSec: 600 });
    expect(await refreshClubData(h.deps, "914493", "common-gen5")).toMatchObject({ result: "blocked" });
    expect(h.log.opened).toBe(1);
    expect(h.log.writes).toBe(0);
  });
  it("an EA answer with a FAILED part never replaces the good copy (kept_old)", async () => {
    const h = await harness({ capture: async () => withStatuses(await real(), { memberCareerStats: "failed" }) }, { cachedAgeSec: 600 });
    const before = h.store.get("914493:common-gen5")!.fetchedAt;
    expect(await refreshClubData(h.deps, "914493", "common-gen5")).toMatchObject({ result: "kept_old" });
    expect(h.log.writes).toBe(0);
    expect(h.store.get("914493:common-gen5")!.fetchedAt).toEqual(before);
  });
  it("EA down is an EA error, an unknown id is not_found (a wrong id must not look like an outage)", async () => {
    const down = withStatuses(await real(), { clubInfo: "failed", overallStats: "failed", memberStats: "empty", memberCareerStats: "empty", leagueMatches: "empty" }, { okCount: 0 });
    expect(await refreshClubData((await harness({ capture: async () => down }, { cachedAgeSec: null })).deps, "1", "nx")).toMatchObject({ result: "ea_error" });
    const none = withStatuses(await real(), { clubInfo: "empty", overallStats: "empty", memberStats: "empty", memberCareerStats: "empty", leagueMatches: "empty" }, { okCount: 0 });
    expect(await refreshClubData((await harness({ capture: async () => none }, { cachedAgeSec: null })).deps, "1", "nx")).toMatchObject({ result: "not_found" });
  });
  it("over the size ceiling is not stored", async () => {
    const big = await real();
    big.summary.bytes = 2_000_001;
    const h = await harness({ capture: async () => big }, { cachedAgeSec: 600 });
    expect(await refreshClubData(h.deps, "914493", "common-gen5")).toMatchObject({ result: "too_large" });
    expect(h.log.writes).toBe(0);
  });
});

describe("refreshClubs (several at once)", () => {
  const refs = [{ clubId: "914493", platform: "common-gen5" }, { clubId: "555", platform: "nx" }, { clubId: "777", platform: "nx" }];
  it("refreshes them ONE AT A TIME, in order, and reports each", async () => {
    const h = await harness({}, { cachedAgeSec: null });
    const out = await refreshClubs(h.deps, refs);
    expect(out.map((r) => [r.clubId, r.result])).toEqual([["914493", "refreshed"], ["555", "refreshed"], ["777", "refreshed"]]);
    expect(h.log.captures).toEqual(["914493:common-gen5", "555:nx", "777:nx"]);
  });
  it("a block stops everything: the rest are skipped and EA is not asked again", async () => {
    let n = 0;
    const h = await harness({ capture: async () => { n++; return { ...(await real()), blocked: true }; } }, { cachedAgeSec: null });
    const out = await refreshClubs(h.deps, refs);
    expect(out.map((r) => r.result)).toEqual(["blocked", "skipped", "skipped"]);
    expect(n).toBe(1);
    expect(h.log.opened).toBe(1);
  });
  it("this user's hourly limit or the shared ceiling also stops the rest", async () => {
    const lim = await harness({}, { cachedAgeSec: null, mine: false });
    expect((await refreshClubs(lim.deps, refs)).map((r) => r.result)).toEqual(["limit", "skipped", "skipped"]);
    const busy = await harness({ admit: async () => ({ ok: false, reason: "breaker", retryAfterSec: 90 }) }, { cachedAgeSec: null });
    expect((await refreshClubs(busy.deps, refs)).map((r) => r.result)).toEqual(["busy", "skipped", "skipped"]);
  });
  it("a club that is too recent or not found does NOT stop the others", async () => {
    const h = await harness({}, { cachedAgeSec: 10 });
    const out = await refreshClubs(h.deps, refs);
    expect(out.map((r) => r.result)).toEqual(["too_recent", "refreshed", "refreshed"]);
  });
});

describe("validateRefreshInput", () => {
  const ok = { clubs: [{ clubId: "914493", platform: "common-gen5" }] };
  it("accepts 1 to 4 clubs and collapses a repeat", () => {
    expect(validateRefreshInput(ok)).toEqual({ ok: true, clubs: ok.clubs });
    expect(validateRefreshInput({ clubs: [ok.clubs[0], ok.clubs[0], { clubId: "914493", platform: "nx" }] })).toMatchObject({ ok: true, clubs: [{ clubId: "914493", platform: "common-gen5" }, { clubId: "914493", platform: "nx" }] });
    expect(validateRefreshInput({ clubs: [1, 2, 3, 4].map((i) => ({ clubId: String(i), platform: "nx" })) }).ok).toBe(true);
  });
  it.each([
    ["null", null], ["no clubs", {}], ["clubs not a list", { clubs: "1" }], ["an empty list", { clubs: [] }],
    ["five clubs", { clubs: [1, 2, 3, 4, 5].map((i) => ({ clubId: String(i), platform: "nx" })) }],
    ["a non-numeric id", { clubs: [{ clubId: "abc", platform: "nx" }] }], ["an injection", { clubs: [{ clubId: "1; DROP", platform: "nx" }] }],
    ["a number id", { clubs: [{ clubId: 5, platform: "nx" }] }], ["a platform EA rejects", { clubs: [{ clubId: "5", platform: "common-gen4" }] }],
    ["a string club", { clubs: ["5.nx"] }],
  ])("rejects %s", (_n, body) => expect(validateRefreshInput(body).ok).toBe(false));
});

describe("the route (read from source: it needs a login and a database)", () => {
  const route = readFileSync(fileURLToPath(new URL("../app/api/refresh/route.ts", import.meta.url)), "utf8");
  it("needs a login and the database", () => {
    expect(route).toMatch(/error: "unauthorized"/);
    expect(route).toMatch(/status: 401/);
    expect(route).toMatch(/process\.env\.DATABASE_URL/);
  });
  it("uses the same shared EA gate, charged per user, and a SEPARATE per-user hourly key", () => {
    expect(route).toMatch(/admitPublic\(gate, `user:\$\{safeId\}`, calls\)/);
    expect(route).toMatch(/dbRateLimit\(`refresh:\$\{safeId\}`, REFRESH_PER_HOUR, 3600\)/);
  });
  it("never calls the AI, so a refresh costs no tokens", () => {
    expect(route).not.toMatch(/from "@\/lib\/llm|getLlm|analyze\(/);
  });
  it("returns times and results only, never the club's data", () => {
    expect(route).not.toMatch(/payload|capture\.payload|summary\./);
  });
  it("fetches exactly the same five parts as a normal load", () => {
    expect(route).toMatch(/PROFILE_PARTS\)/);
  });
});
