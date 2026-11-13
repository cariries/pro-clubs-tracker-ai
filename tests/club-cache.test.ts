// The shared 15-minute club cache: rules only (the database, the gate and EA are fakes here; the real SQL is in
// analysis-db.test.ts). The point of the cache is to protect EA, so most tests count EA calls.
import { describe, expect, it } from "vitest";
import { CACHE_TTL_SEC, MAX_CACHED_BYTES, getClubData, isFresh, loadClubsForAnalysis, type CacheRow, type ClubCacheDeps } from "@/lib/club-cache";
import { PART_KEYS, captureClub, type CaptureResult, type PartStatus } from "@/lib/club-capture";
import { PROFILE_PARTS } from "@/lib/public-data";
import { baseEa, mockEa } from "./helpers";

const T0 = new Date("2026-11-13T12:00:00.000Z");
const at = (secAfter: number) => new Date(T0.getTime() + secAfter * 1000);

const real = () => captureClub("914493", "common-gen5", { fetchEa: mockEa(baseEa()) as never }, T0, PROFILE_PARTS);
const withStatuses = (cap: CaptureResult, over: Partial<Record<(typeof PART_KEYS)[number], PartStatus>>, extra: Partial<CaptureResult> = {}): CaptureResult => ({
  ...cap,
  summary: { ...cap.summary, statuses: { ...cap.summary.statuses, ...over } },
  ...extra,
});

function harness(over: Partial<ClubCacheDeps> = {}, clock = { now: T0 }) {
  const store = new Map<string, CacheRow>();
  const log = { captures: [] as string[], admits: [] as number[], writes: 0, opened: 0 };
  const deps: ClubCacheDeps = {
    read: async (c, p) => store.get(`${c}:${p}`) ?? null,
    write: async (c, p, capture, fetchedAt) => { log.writes++; store.set(`${c}:${p}`, { capture, fetchedAt }); },
    admit: async (calls) => { log.admits.push(calls); return { ok: true }; },
    capture: async (c, p) => { log.captures.push(`${c}:${p}`); return real(); },
    openBreaker: async () => { log.opened++; },
    now: () => clock.now,
    ...over,
  };
  return { deps, store, log, clock };
}

describe("the cache window", () => {
  it("is about 15 minutes, as the user asked", () => {
    expect(CACHE_TTL_SEC).toBe(900);
  });
  it("an entry is fresh up to (not including) 15 minutes and stale from then on", () => {
    expect(isFresh(T0, at(0))).toBe(true);
    expect(isFresh(T0, at(899))).toBe(true);
    expect(isFresh(T0, at(900))).toBe(false);
    expect(isFresh(T0, at(5000))).toBe(false);
  });
});

describe("getClubData", () => {
  it("a miss fetches from EA once (4 calls charged to the gate), stores it, and says so", async () => {
    const h = harness();
    const r = await getClubData(h.deps, "914493", "common-gen5");
    expect(r).toMatchObject({ ok: true, source: "ea", fetchedAt: T0 });
    expect(h.log.captures).toEqual(["914493:common-gen5"]);
    expect(h.log.admits).toEqual([PROFILE_PARTS.length]);
    expect(h.log.writes).toBe(1);
  });

  it("a fresh entry is served with NO EA call and NO charge to the gate (the whole point)", async () => {
    const h = harness();
    await getClubData(h.deps, "914493", "common-gen5");
    h.clock.now = at(600);
    const r = await getClubData(h.deps, "914493", "common-gen5");
    expect(r).toMatchObject({ ok: true, source: "cache", fetchedAt: T0 });
    expect(h.log.captures).toHaveLength(1);
    expect(h.log.admits).toHaveLength(1);
  });

  it("a stale entry is fetched again and overwritten", async () => {
    const h = harness();
    await getClubData(h.deps, "914493", "common-gen5");
    h.clock.now = at(901);
    const r = await getClubData(h.deps, "914493", "common-gen5");
    expect(r).toMatchObject({ ok: true, source: "ea", fetchedAt: at(901) });
    expect(h.log.captures).toHaveLength(2);
    expect(h.store.get("914493:common-gen5")!.fetchedAt).toEqual(at(901));
  });

  it("the cache is per club AND platform: another platform or club is a miss", async () => {
    const h = harness();
    await getClubData(h.deps, "914493", "common-gen5");
    await getClubData(h.deps, "914493", "nx");
    await getClubData(h.deps, "555", "common-gen5");
    expect(h.log.captures).toEqual(["914493:common-gen5", "914493:nx", "555:common-gen5"]);
  });

  it("is refused, with no EA call and nothing stored, when the gate says no", async () => {
    const h = harness({ admit: async () => ({ ok: false, reason: "global", retryAfterSec: 12 }) });
    expect(await getClubData(h.deps, "914493", "common-gen5")).toEqual({ ok: false, error: "refused", retryAfterSec: 12 });
    expect(h.log.captures).toHaveLength(0);
    expect(h.log.writes).toBe(0);
  });

  it("a refused gate does not stop a cache hit (cached clubs still work while EA is paused)", async () => {
    const h = harness();
    await getClubData(h.deps, "914493", "common-gen5");
    h.deps.admit = async () => ({ ok: false, reason: "breaker", retryAfterSec: 200 });
    expect(await getClubData(h.deps, "914493", "common-gen5")).toMatchObject({ ok: true, source: "cache" });
  });

  it("a block opens the breaker and stores nothing", async () => {
    const h = harness({ capture: async () => ({ ...(await real()), blocked: true }) });
    expect(await getClubData(h.deps, "914493", "common-gen5")).toEqual({ ok: false, error: "blocked" });
    expect(h.log.opened).toBe(1);
    expect(h.log.writes).toBe(0);
  });

  it("an unknown club (nothing usable, nothing failed) is not_found, and is not cached", async () => {
    const empty = withStatuses(await real(), { clubInfo: "empty", overallStats: "empty", memberStats: "empty", memberCareerStats: "empty" }, { okCount: 0 });
    const h = harness({ capture: async () => empty });
    expect(await getClubData(h.deps, "1", "nx")).toEqual({ ok: false, error: "not_found" });
    expect(h.log.writes).toBe(0);
  });

  it("EA trouble is an EA error, never 'no such club' (a wrong id must not look like an outage, nor the reverse)", async () => {
    const down = withStatuses(await real(), { clubInfo: "failed", overallStats: "failed", memberStats: "empty", memberCareerStats: "empty" }, { okCount: 0 });
    expect(await getClubData(harness({ capture: async () => down }).deps, "1", "nx")).toEqual({ ok: false, error: "ea_error" });
    const mixed = withStatuses(await real(), { clubInfo: "empty", overallStats: "empty", memberStats: "failed" }, { okCount: 1 });
    expect(await getClubData(harness({ capture: async () => mixed }).deps, "1", "nx")).toEqual({ ok: false, error: "ea_error" });
  });

  it("a fetch with a FAILED part is used for this question but NOT shared for 15 minutes", async () => {
    const partial = withStatuses(await real(), { memberCareerStats: "failed" });
    const h = harness({ capture: async () => partial });
    expect(await getClubData(h.deps, "914493", "common-gen5")).toMatchObject({ ok: true, source: "ea" });
    expect(h.log.writes).toBe(0);
    await getClubData(h.deps, "914493", "common-gen5");
    expect(h.log.admits).toHaveLength(2); // went to EA again (one gate charge per live fetch) because nothing was cached
  });

  it("refuses to store or use data over the size ceiling", async () => {
    const big = await real();
    big.summary.bytes = MAX_CACHED_BYTES + 1;
    const h = harness({ capture: async () => big });
    expect(await getClubData(h.deps, "914493", "common-gen5")).toEqual({ ok: false, error: "too_large" });
    expect(h.log.writes).toBe(0);
  });

  it("does not call EA at all when a fresh entry exists, however many users ask (call count stays 1)", async () => {
    const h = harness();
    await Promise.all([1, 2, 3, 4, 5].map(() => getClubData(h.deps, "914493", "common-gen5")));
    // concurrent first requests may each miss; but once stored, all later ones hit
    const before = h.log.captures.length;
    for (let i = 0; i < 20; i++) await getClubData(h.deps, "914493", "common-gen5");
    expect(h.log.captures.length).toBe(before);
  });
});

describe("loadClubsForAnalysis", () => {
  const refs = [{ clubId: "914493", platform: "common-gen5" }, { clubId: "555", platform: "nx" }];

  it("loads clubs in the order asked, counts how many came from EA, and keeps club and platform in the id", async () => {
    const h = harness();
    await getClubData(h.deps, "914493", "common-gen5"); // already cached
    const r = await loadClubsForAnalysis(h.deps, refs);
    expect(r).toMatchObject({ ok: true, fetchedFromEa: 1 });
    if (!r.ok) return;
    expect(r.clubs.map((c) => c.id)).toEqual(["914493:common-gen5", "555:nx"]);
    expect(r.clubs.map((c) => c.platform)).toEqual(["common-gen5", "nx"]);
    expect(h.log.captures).toEqual(["914493:common-gen5", "555:nx"]);
  });

  it("fetches one club at a time and STOPS at the first failure: later clubs never touch EA", async () => {
    let n = 0;
    const h = harness({ capture: async (c) => { n++; return c === "914493" ? { ...(await real()), blocked: true } : real(); } });
    const r = await loadClubsForAnalysis(h.deps, refs);
    expect(r).toMatchObject({ ok: false, error: "blocked", clubId: "914493" });
    expect(n).toBe(1);
  });

  it("names the club that failed", async () => {
    const h = harness({ admit: async () => ({ ok: false, reason: "visitor", retryAfterSec: 3 }) });
    expect(await loadClubsForAnalysis(h.deps, refs)).toMatchObject({ ok: false, error: "refused", retryAfterSec: 3, clubId: "914493" });
  });

  it("hands over plain data the comparison can read", async () => {
    const h = harness();
    const r = await loadClubsForAnalysis(h.deps, [refs[0]]);
    expect(r.ok && typeof r.clubs[0].data === "object" && (r.clubs[0].data as any).parts.clubInfo.status).toBe("ok");
    expect(r.ok && r.clubs[0].createdAt).toBe(T0.toISOString());
  });
});
