// The circuit breaker and the public gate on a REAL SQL engine (PGlite built from the project's migrations).
// The breaker is a row in the existing rate_limit table; this checks that its SQL really opens, expires and resets.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { breakerState, openBreaker } from "@/lib/public-db";
import { buildRateLimitQuery } from "@/lib/rate-limit-db";
import { BREAKER_KEY, PUBLIC_LIMITS, admitPublic } from "@/lib/public-limit";
import { makeDb } from "./pg";

let client: Awaited<ReturnType<typeof makeDb>>["client"];
let db: Awaited<ReturnType<typeof makeDb>>["db"];

beforeAll(async () => {
  ({ client, db } = await makeDb());
});
beforeEach(async () => {
  await client.exec(`TRUNCATE "rate_limit";`);
});

const realGate = () => ({
  hit: async (key: string, limit: number, windowSec: number) => {
    const [row] = await buildRateLimitQuery(db as never, key, windowSec);
    const elapsed = (Date.now() - row.windowStart.getTime()) / 1000;
    return { ok: row.count <= limit, retryAfterSec: Math.min(windowSec, Math.max(1, Math.ceil(windowSec - elapsed))) };
  },
  breakerOpen: () => breakerState(db as never),
});

describe("circuit breaker SQL", () => {
  it("is closed when nothing has been recorded", async () => {
    expect(await breakerState(db as never)).toEqual({ open: false, retryAfterSec: 0 });
  });

  it("opens, reports roughly the full cool-down, and stays open", async () => {
    await openBreaker(db as never);
    const s = await breakerState(db as never);
    expect(s.open).toBe(true);
    expect(s.retryAfterSec).toBeGreaterThan(PUBLIC_LIMITS.breakerSeconds - 5);
    expect(s.retryAfterSec).toBeLessThanOrEqual(PUBLIC_LIMITS.breakerSeconds);
  });

  it("closes by itself once the cool-down has passed", async () => {
    await openBreaker(db as never);
    await client.exec(`UPDATE "rate_limit" SET "windowStart" = now() - interval '${PUBLIC_LIMITS.breakerSeconds + 5} seconds' WHERE "key" = '${BREAKER_KEY}'`);
    expect(await breakerState(db as never)).toEqual({ open: false, retryAfterSec: 0 });
  });

  it("is still open just before the cool-down ends and counts down", async () => {
    await openBreaker(db as never);
    await client.exec(`UPDATE "rate_limit" SET "windowStart" = now() - interval '${PUBLIC_LIMITS.breakerSeconds - 30} seconds' WHERE "key" = '${BREAKER_KEY}'`);
    const s = await breakerState(db as never);
    expect(s.open).toBe(true);
    expect(s.retryAfterSec).toBeGreaterThan(25);
    expect(s.retryAfterSec).toBeLessThanOrEqual(31);
  });

  it("opening again while open restarts the cool-down, and keeps exactly one row", async () => {
    await openBreaker(db as never);
    await client.exec(`UPDATE "rate_limit" SET "windowStart" = now() - interval '200 seconds' WHERE "key" = '${BREAKER_KEY}'`);
    const before = (await breakerState(db as never)).retryAfterSec;
    await openBreaker(db as never);
    const after = (await breakerState(db as never)).retryAfterSec;
    expect(after).toBeGreaterThan(before + 150);
    expect((await client.query(`SELECT 1 FROM "rate_limit" WHERE "key" = '${BREAKER_KEY}'`)).rows).toHaveLength(1);
  });

  it("does not disturb other counters", async () => {
    await buildRateLimitQuery(db as never, "public:visitor:1.1.1.1", 60);
    await openBreaker(db as never);
    const rows = (await client.query<{ key: string; count: number }>(`SELECT "key","count" FROM "rate_limit" ORDER BY "key"`)).rows;
    expect(rows.map((r) => r.key)).toEqual([BREAKER_KEY, "public:visitor:1.1.1.1"]);
    expect(rows.find((r) => r.key === "public:visitor:1.1.1.1")!.count).toBe(1);
  });
});

describe("the public gate on a real database", () => {
  it("lets a visitor through up to the per-visitor limit and refuses the next, per visitor", async () => {
    const gate = realGate();
    for (let i = 0; i < PUBLIC_LIMITS.perVisitor.limit; i++) {
      expect((await admitPublic(gate, "1.1.1.1", 0)).ok, `request ${i + 1}`).toBe(true);
    }
    expect(await admitPublic(gate, "1.1.1.1", 0)).toMatchObject({ ok: false, reason: "visitor" });
    expect((await admitPublic(gate, "2.2.2.2", 0)).ok).toBe(true); // a different visitor is unaffected
  });

  it("stops everyone once the GLOBAL EA budget is spent, even visitors who are within their own limit", async () => {
    const gate = realGate();
    const per = PUBLIC_LIMITS.globalEa.limit;
    // spend the whole budget with 4-call profile views from many different visitors
    let admitted = 0;
    for (let v = 0; v < 100 && admitted < per / 4; v++) {
      const r = await admitPublic(gate, `10.0.0.${v}`, 4);
      if (r.ok) admitted++;
    }
    expect(admitted).toBe(per / 4);
    expect(await admitPublic(gate, "9.9.9.9", 4)).toMatchObject({ ok: false, reason: "global" });
    expect(await admitPublic(gate, "9.9.9.8", 1)).toMatchObject({ ok: false, reason: "global" });
  });

  it("an open breaker refuses everyone and uses none of the counters", async () => {
    await openBreaker(db as never);
    const r = await admitPublic(realGate(), "1.1.1.1", 1);
    expect(r).toMatchObject({ ok: false, reason: "breaker" });
    expect(r.ok === false && r.retryAfterSec).toBeGreaterThan(0);
    expect((await client.query(`SELECT 1 FROM "rate_limit" WHERE "key" LIKE 'public:%' AND "key" <> '${BREAKER_KEY}'`)).rows).toHaveLength(0);
  });
});
