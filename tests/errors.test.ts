import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { dbErrorCode, describeUnexpected } from "@/lib/errors";
import { reserveSql } from "@/lib/llm/usage";
import { makeDb } from "./pg";

const params = { provider: "p", model: "m", estMicroUsd: 0, capMicroUsd: 5_000_000, userLimit: 5 };

describe("error codes from REAL database errors (PGlite, wrapped by Drizzle)", () => {
  it("reports 23503 when the user row is missing (foreign key)", async () => {
    const { db } = await makeDb();
    const err = await db.execute(reserveSql({ userId: "ghost", ...params })).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(dbErrorCode(err)).toBe("23503");
    const info = describeUnexpected(err);
    expect(info.code).toBe("23503");
    expect(info.cause).toMatch(/foreign key|violates/i);
  });

  it("reports 42P01 when the table does not exist (migration not applied to this database)", async () => {
    const bare = drizzle(new PGlite());
    const err = await bare.execute(reserveSql({ userId: "u1", ...params })).then(() => null, (e) => e);
    expect(dbErrorCode(err)).toBe("42P01");
    expect(describeUnexpected(err).cause).toMatch(/llm_usage/);
  });

  it("never puts SQL or parameters in the log summary", async () => {
    const bare = drizzle(new PGlite());
    const err = await bare.execute(reserveSql({ userId: "secret-user-id", ...params })).then(() => null, (e) => e);
    const info = describeUnexpected(err);
    const line = `${info.summary} ${info.cause}`;
    expect(line).not.toMatch(/INSERT INTO|SELECT|secret-user-id/);
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(600);
  });
});

describe("dbErrorCode / describeUnexpected on other inputs", () => {
  it("finds a code on the error or deeper in the cause chain", () => {
    expect(dbErrorCode({ code: "42P01" })).toBe("42P01");
    expect(dbErrorCode(new Error("x", { cause: { code: "23505" } }))).toBe("23505");
    expect(dbErrorCode({ cause: { cause: { code: "22003" } } })).toBe("22003");
  });
  it("ignores things that are not SQLSTATE codes", () => {
    for (const bad of [null, undefined, "boom", 5, {}, { code: "ECONNRESET" }, { code: "toolong1" }, { code: 42 }, { code: "42p01" }]) expect(dbErrorCode(bad)).toBeNull();
  });
  it("copes with non-Error throws and circular causes", () => {
    expect(describeUnexpected("plain string").summary).toContain("plain string");
    expect(describeUnexpected(undefined).code).toBeNull();
    const a: any = new Error("a");
    a.cause = a;
    expect(() => describeUnexpected(a)).not.toThrow();
    expect(() => dbErrorCode(a)).not.toThrow();
  });
});
