// Runs the REAL reservation and rate-limit SQL on an in-process Postgres (PGlite, WebAssembly). This is the
// first place the cap logic executes against an actual SQL engine. It is not Neon: a different build of
// Postgres behind the same SQL language, so it proves the statements are valid and logically correct, not
// that Neon's HTTP driver returns the same row shapes.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildRateLimitQuery } from "@/lib/rate-limit-db";
import { reserveSql } from "@/lib/llm/usage";
import * as schema from "@/db/schema";
import { makeDb } from "./pg";

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  ({ client, db } = await makeDb());
});

beforeEach(async () => {
  await client.exec(`TRUNCATE "llm_usage"; TRUNCATE "rate_limit"; DELETE FROM "user"; INSERT INTO "user" ("id") VALUES ('u1'), ('u2');`);
});

const reserve = async (userId: string, est: number, cap: number, limit: number) => {
  const r = await db.execute(reserveSql({ userId, provider: "p", model: "m", estMicroUsd: est, capMicroUsd: cap, userLimit: limit }));
  return r.rows.length === 1;
};

describe("llm_usage reservation (global cap + per-user limit)", () => {
  it("reserves while under the cap and records the estimate", async () => {
    expect(await reserve("u1", 1000, 5000, 5)).toBe(true);
    const { rows } = await client.query<{ status: string; costMicroUsd: number }>(`SELECT "status","costMicroUsd" FROM "llm_usage"`);
    expect(rows).toEqual([{ status: "reserved", costMicroUsd: 1000 }]);
  });

  it("refuses the call that would cross the global cap, but allows one that lands exactly on it", async () => {
    expect(await reserve("u1", 2000, 5000, 99)).toBe(true);
    expect(await reserve("u2", 2000, 5000, 99)).toBe(true); // total 4000
    expect(await reserve("u2", 1000, 5000, 99)).toBe(true); // total 5000 == cap: allowed
    expect(await reserve("u1", 1, 5000, 99)).toBe(false); // 5001 > cap
    const { rows } = await client.query(`SELECT 1 FROM "llm_usage"`);
    expect(rows).toHaveLength(3); // the refused call left no row behind
  });

  it("enforces the per-user daily limit exactly, and other users are unaffected", async () => {
    for (let i = 0; i < 3; i++) expect(await reserve("u1", 1, 1_000_000, 3)).toBe(true);
    expect(await reserve("u1", 1, 1_000_000, 3)).toBe(false); // the 4th is refused
    expect(await reserve("u2", 1, 1_000_000, 3)).toBe(true);
  });

  it("counts a finalised row's ACTUAL cost toward the cap, not its reservation", async () => {
    expect(await reserve("u1", 4000, 5000, 99)).toBe(true);
    await client.exec(`UPDATE "llm_usage" SET "status"='ok', "costMicroUsd"=500`);
    expect(await reserve("u2", 4000, 5000, 99)).toBe(true); // 500 + 4000 <= 5000
    expect(await reserve("u2", 1000, 5000, 99)).toBe(false); // 4500 + 1000 > 5000
  });

  it("ignores usage from before today (UTC) for both the cap and the user limit", async () => {
    await client.exec(`INSERT INTO "llm_usage" ("userId","provider","model","status","costMicroUsd","createdAt")
      VALUES ('u1','p','m','ok', 9999999, now() - interval '2 days')`);
    expect(await reserve("u1", 1000, 5000, 1)).toBe(true); // yesterday's spend and call don't count
    expect(await reserve("u1", 1, 5000, 1)).toBe(false); // today's call does
  });

  it("is atomic: concurrent reservations cannot both slip under the cap", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve("u1", 1000, 5000, 99)));
    expect(results.filter(Boolean)).toHaveLength(5); // exactly cap / cost
    const { rows } = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "llm_usage"`);
    expect(rows[0].n).toBe(5);
  });

  it("returns the new row id so the caller can finalise it", async () => {
    const r = await db.execute(reserveSql({ userId: "u1", provider: "p", model: "m", estMicroUsd: 1, capMicroUsd: 10, userLimit: 5 }));
    expect(typeof (r.rows[0] as { id: unknown }).id).toBe("string");
  });
});

describe("rate_limit upsert (snapshot saving)", () => {
  const hit = async (key: string, windowSec: number) => {
    const [row] = await buildRateLimitQuery(db as never, key, windowSec);
    return row.count;
  };

  it("counts hits within a window and keeps keys separate", async () => {
    expect(await hit("a", 3600)).toBe(1);
    expect(await hit("a", 3600)).toBe(2);
    expect(await hit("a", 3600)).toBe(3);
    expect(await hit("b", 3600)).toBe(1);
  });

  it("starts a new window once the old one has expired", async () => {
    await hit("a", 3600);
    await hit("a", 3600);
    await client.exec(`UPDATE "rate_limit" SET "windowStart" = now() - interval '2 hours' WHERE "key"='a'`);
    expect(await hit("a", 3600)).toBe(1); // reset
    expect(await hit("a", 3600)).toBe(2);
  });

  it("does not reset a window that is still open", async () => {
    await hit("a", 3600);
    await client.exec(`UPDATE "rate_limit" SET "windowStart" = now() - interval '30 minutes' WHERE "key"='a'`);
    expect(await hit("a", 3600)).toBe(2);
  });

  it("rejects an invalid window length", () => {
    for (const bad of [0, -1, 1.5, 86_401, NaN]) expect(() => buildRateLimitQuery(db as never, "k", bad)).toThrow(/windowSec/);
  });
});
