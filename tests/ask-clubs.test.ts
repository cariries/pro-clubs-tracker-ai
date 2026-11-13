import { describe, expect, it } from "vitest";
import { addAskClub, askPath, formatAskClubs, parseAskClubs, removeAskClub } from "@/lib/ask-clubs";

describe("parseAskClubs (the URL is untrusted)", () => {
  it("reads club.platform pairs in order", () => {
    expect(parseAskClubs("914493.common-gen5,123.nx")).toEqual([{ clubId: "914493", platform: "common-gen5" }, { clubId: "123", platform: "nx" }]);
  });
  it("drops invalid entries but keeps the valid ones", () => {
    expect(parseAskClubs("abc.nx,5.common-gen4,.nx,5,7.nx,8.__proto__,9.nx<script>")).toEqual([{ clubId: "7", platform: "nx" }]);
  });
  it("collapses duplicates and caps the list at 4", () => {
    expect(parseAskClubs("1.nx,1.nx,1.common-gen5")).toHaveLength(2);
    expect(parseAskClubs("1.nx,2.nx,3.nx,4.nx,5.nx,6.nx").map((c) => c.clubId)).toEqual(["1", "2", "3", "4"]);
  });
  it("returns an empty list for anything that is not text", () => {
    for (const v of [undefined, null, 5, [], {}, ["1.nx"], ""]) expect(parseAskClubs(v), String(v)).toEqual([]);
  });
  it("ignores everything after 400 characters instead of working through a huge value", () => {
    expect(parseAskClubs("1.nx," + "x".repeat(2000) + ",2.nx")).toEqual([{ clubId: "1", platform: "nx" }]);
  });
});

describe("add, remove and paths", () => {
  const a = { clubId: "1", platform: "nx" };
  const b = { clubId: "2", platform: "nx" };
  it("adds a club once, and says when the list is full", () => {
    expect(addAskClub([a], b)).toEqual({ clubs: [a, b], added: true, full: false });
    expect(addAskClub([a], a)).toEqual({ clubs: [a], added: false, full: false });
    const four = [1, 2, 3, 4].map((i) => ({ clubId: String(i), platform: "nx" }));
    expect(addAskClub(four, { clubId: "9", platform: "nx" })).toEqual({ clubs: four, added: false, full: true });
  });
  it("the same id on another platform is another club", () => {
    expect(addAskClub([a], { clubId: "1", platform: "common-gen5" }).added).toBe(true);
  });
  it("removes only the matching club", () => {
    expect(removeAskClub([a, b], a)).toEqual([b]);
    expect(removeAskClub([a], b)).toEqual([a]);
  });
  it("round-trips through the URL, and an empty list goes to the bare page", () => {
    expect(parseAskClubs(decodeURIComponent(askPath([a, b]).split("clubs=")[1]))).toEqual([a, b]);
    expect(formatAskClubs([a, b])).toBe("1.nx,2.nx");
    expect(askPath([])).toBe("/analysis");
  });
});

import { ageParts, ageSeconds, isRefreshResult, readRefreshResponse, REFRESH_RESULTS } from "@/lib/ask-clubs";
import { REFRESH } from "@/lib/ui-text";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("ageSeconds and ageParts (how old the club data is)", () => {
  const NOW = Date.parse("2026-11-14T12:00:00.000Z");
  it("is the whole seconds since the stored time", () => {
    expect(ageSeconds("2026-11-14T11:59:00.000Z", NOW)).toBe(60);
    expect(ageSeconds("2026-11-14T11:00:00.000Z", NOW)).toBe(3600);
    expect(ageSeconds("2026-11-14T12:00:00.000Z", NOW)).toBe(0);
  });
  it("a time in the future counts as 0, never negative", () => {
    expect(ageSeconds("2026-11-14T13:00:00.000Z", NOW)).toBe(0);
  });
  it("no time, junk or a non-string gives null (shown as 'not loaded yet')", () => {
    for (const v of [null, undefined, "", "not a date", "2026-13-45"]) expect(ageSeconds(v as never, NOW), String(v)).toBeNull();
  });
  it("words the age in the right unit at each boundary", () => {
    expect(ageParts(0)).toEqual({ unit: "now", n: 0 });
    expect(ageParts(59)).toEqual({ unit: "now", n: 0 });
    expect(ageParts(60)).toEqual({ unit: "min", n: 1 });
    expect(ageParts(3599)).toEqual({ unit: "min", n: 59 });
    expect(ageParts(3600)).toEqual({ unit: "hour", n: 1 });
    expect(ageParts(86_399)).toEqual({ unit: "hour", n: 23 });
    expect(ageParts(86_400)).toEqual({ unit: "day", n: 1 });
    expect(ageParts(86_400 * 5 + 99)).toEqual({ unit: "day", n: 5 });
  });
  it("NaN, Infinity and negatives do not break it", () => {
    expect(ageParts(Number.NaN)).toEqual({ unit: "now", n: 0 });
    expect(ageParts(-50)).toEqual({ unit: "now", n: 0 });
    expect(ageParts(Number.POSITIVE_INFINITY).unit).toBe("now");
  });
});

describe("readRefreshResponse (the browser does not trust the route's answer)", () => {
  const good = { results: [{ clubId: "1", platform: "nx", result: "refreshed", clubName: "A", fetchedAt: "2026-11-14T12:00:00.000Z" }, { clubId: "2", platform: "nx", result: "too_recent", clubName: null, fetchedAt: "2026-11-14T11:59:30.000Z", retryAfterSec: 30 }], limitPerHour: 20 };
  it("reads a good answer", () => {
    const r = readRefreshResponse(good)!;
    expect(r.limitPerHour).toBe(20);
    expect(r.results.map((x) => x.result)).toEqual(["refreshed", "too_recent"]);
    expect(r.results[1].retryAfterSec).toBe(30);
    expect(r.results[0].clubName).toBe("A");
  });
  it("junk gives null, and bad entries are dropped instead of shown", () => {
    for (const v of [null, undefined, 5, "x", [], {}, { results: "x" }]) expect(readRefreshResponse(v), String(v)).toBeNull();
    const r = readRefreshResponse({ results: [null, 5, { clubId: 1, platform: "nx", result: "x" }, { clubId: "3", platform: "nx" }, { clubId: "4", platform: "nx", result: "refreshed" }] })!;
    expect(r.results.map((x) => x.clubId)).toEqual(["4"]);
  });
  it("keeps only text names and times, caps a silly retry time, and ignores a negative or NaN one", () => {
    const r = readRefreshResponse({ results: [{ clubId: "1", platform: "nx", result: "limit", clubName: 5, fetchedAt: 7, retryAfterSec: 9e9 }, { clubId: "2", platform: "nx", result: "limit", retryAfterSec: -4 }, { clubId: "3", platform: "nx", result: "limit", retryAfterSec: Number.NaN }], limitPerHour: -1 })!;
    expect(r.results[0]).toMatchObject({ clubName: null, fetchedAt: null, retryAfterSec: 86_400 });
    expect(r.results[1].retryAfterSec).toBeUndefined();
    expect(r.results[2].retryAfterSec).toBeUndefined();
    expect(r.limitPerHour).toBeNull();
  });
});

describe("refresh wording and wiring", () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
  const client = read("app/analysis/AnalysisClient.tsx");
  it("every refresh string has both languages, English without Chinese, and matching placeholders", () => {
    const ph = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [k, v] of Object.entries(REFRESH)) {
      expect(/[㐀-鿿]/.test(v.zh), k).toBe(true);
      expect(/[㐀-鿿]/.test(v.en), k).toBe(false);
      expect(ph(v.zh), k).toBe(ph(v.en));
    }
  });
  it("the page can word every result the route can return (an unknown one falls to a safe EA-error message)", () => {
    for (const r of REFRESH_RESULTS) expect(isRefreshResult(r)).toBe(true);
    expect(isRefreshResult("surprise")).toBe(false);
    for (const r of REFRESH_RESULTS) expect(client, r).toMatch(new RegExp(`case "${r}"|default:`));
    for (const r of ["refreshed", "too_recent", "limit", "busy", "kept_old", "blocked", "not_found", "too_large", "skipped"]) expect(client, r).toContain(`case "${r}"`);
  });
  it("the help text says what a refresh costs and that it does not use the AI", () => {
    expect(REFRESH.help.en).toMatch(/5 calls per club/);
    expect(REFRESH.help.en).toMatch(/once a minute per club/);
    expect(REFRESH.help.en).toMatch(/20 per hour/);
    expect(REFRESH.help.en).toMatch(/does not use the AI/);
  });
  it("the button posts the chosen clubs to /api/refresh, is disabled while working, and shows only with a club chosen", () => {
    expect(client).toMatch(/fetch\("\/api\/refresh", \{ method: "POST"/);
    expect(client).toMatch(/disabled=\{refreshing\}/);
    expect(client).toMatch(/clubs\.length > 0 && \(\s*<div className="refresh">/);
  });
  it("a 401 says to sign in, and a non-ok or unreadable answer says it failed (never a blank)", () => {
    expect(client).toMatch(/res\.status === 401/);
    expect(client).toMatch(/REFRESH\.signIn/);
    expect(client).toMatch(/!res\.ok \|\| !parsed/);
    expect(client).toMatch(/REFRESH\.failed/);
  });
  it("the data age updates from the answer, and the clock ticks so 'x min ago' stays right", () => {
    expect(client).toMatch(/setInfo\(next\)/);
    expect(client).toMatch(/setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 30_000\)/);
  });
  it("the Ask AI page reads each club's time from the cache only (a database read, never EA)", () => {
    const page = read("app/analysis/page.tsx");
    expect(page).toMatch(/readClubCache\(c\.clubId, c\.platform\)/);
    expect(page).toMatch(/fetchedAt: row\.fetchedAt\.toISOString\(\)/);
    expect(page).not.toMatch(/fetchEa|captureClub/);
  });
});
