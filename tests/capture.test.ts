import { describe, expect, it } from "vitest";
import { MATCHES_PER_PART, captureClub } from "@/lib/club-capture";
import { dataAgeDays, formatIso, formatUnix } from "@/lib/data-utils";
import { parseEaResponse } from "@/lib/ea-parse";
import { buildEaUrl } from "@/lib/ea";
import { baseEa, capture, fixture, mockEa } from "./helpers";

const NOW = "2026-11-12T10:00:00Z";

describe("captureClub", () => {
  it("captures six parts as parsed data only and records empty vs ok", async () => {
    const cap = await capture(baseEa(), NOW);
    expect(cap.summary.statuses).toEqual({
      clubInfo: "ok", overallStats: "ok", memberStats: "ok", memberCareerStats: "ok", leagueMatches: "ok", playoffMatches: "empty",
    });
    expect(cap.okCount).toBe(5);
    expect(cap.blocked).toBe(false);
    expect(cap.summary).toMatchObject({ clubName: "Test 1 team", memberCount: 3, leagueMatchCount: 1, playoffMatchCount: 0, newestMatchTimestamp: 1790789977 });
    expect(cap.payload.capturedAt).toBe("2026-11-12T10:00:00.000Z");
    expect(JSON.stringify(cap.payload)).not.toContain('"raw"');
    expect(cap.summary.bytes).toBe(Buffer.byteLength(JSON.stringify(cap.payload)));
  });

  it("only asks EA for allowlisted URLs, with maxResultCount on both match calls", async () => {
    const urls: string[] = [];
    const spy = async (endpoint: string, params: URLSearchParams) => {
      const built = buildEaUrl(endpoint, params);
      expect(built.ok, endpoint).toBe(true);
      if (built.ok) urls.push(built.url);
      return mockEa(baseEa())(endpoint, params);
    };
    await captureClub("914493", "common-gen5", { fetchEa: spy as never });
    expect(urls).toHaveLength(6);
    expect(urls.filter((u) => u.includes(`maxResultCount=${MATCHES_PER_PART}`))).toHaveLength(2);
  });

  it("keeps the surviving parts when others fail, and says why", async () => {
    const good = mockEa(baseEa());
    const flaky = async (endpoint: string, params: URLSearchParams) => {
      if (endpoint === "memberStats") return { ok: false, kind: "timeout", status: 504, body: {} };
      if (endpoint === "overallStats") return { ok: false, kind: "upstream_error", status: 502, body: { upstreamStatus: 500 } };
      if (endpoint === "memberCareerStats") return { ok: true, endpoint, data: {}, parsed: null, parseError: "expected a `members` array" };
      return good(endpoint, params);
    };
    const cap = await captureClub("914493", "common-gen5", { fetchEa: flaky as never });
    expect(cap.payload.parts.memberStats).toEqual({ status: "failed", error: "timeout" });
    expect(cap.payload.parts.overallStats.error).toBe("upstream_error (HTTP 500)");
    expect(cap.payload.parts.memberCareerStats.error).toMatch(/^parse: /);
    expect(cap.payload.parts.clubInfo.status).toBe("ok");
    expect(cap.okCount).toBe(2);
    expect(Object.values(cap.summary.statuses).filter((x) => x === "failed")).toHaveLength(3); // the cache must not share this as complete
  });

  it("flags a blocked EA response and reports nothing captured when everything fails", async () => {
    const blocked = await captureClub("1", "nx", { fetchEa: (async () => ({ ok: false, kind: "blocked", status: 503, body: { upstreamStatus: 403 } })) as never });
    expect(blocked.blocked).toBe(true);
    expect(blocked.okCount).toBe(0);
    expect(blocked.payload.parts.clubInfo.error).toBe("blocked (HTTP 403)");
  });
});

describe("date helpers", () => {
  it("formats dates in UTC and handles missing values", () => {
    expect(formatUnix(1790789977)).toBe("2026-09-30 17:39 UTC");
    expect(formatUnix(null)).toBeNull();
    expect(formatUnix(NaN)).toBeNull();
    expect(formatIso("2026-11-11T17:46:04.059Z")).toBe("2026-11-11 17:46 UTC");
    expect(formatIso("junk")).toBeNull();
    expect(dataAgeDays("2026-11-11T17:46:04Z", 1790789977)).toBe(42);
    expect(dataAgeDays(null, 1)).toBeNull();
    expect(dataAgeDays("2026-01-01T00:00:00Z", 1790789977)).toBe(0);
  });
});

describe("fixtures stay valid EA shapes", () => {
  it("memberStats.live parses to three players", () => {
    const r = parseEaResponse("memberStats", fixture("memberStats.live"));
    expect((r.parsed as { members: unknown[] }).members).toHaveLength(3);
  });
});
