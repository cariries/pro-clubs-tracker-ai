import { describe, expect, it } from "vitest";
import { ENDPOINTS, MATCH_TYPES, buildEaUrl } from "@/lib/ea";
import { fetchEa } from "@/lib/ea-fetch";
import { PARSED_ENDPOINTS, parseEaResponse } from "@/lib/ea-parse";
import { divisionLabel, playoffResultLabel, positionLabel, reputationLabel } from "@/lib/ea-labels";
import { fixture } from "./helpers";

const q = (s: string) => new URLSearchParams(s);

describe("buildEaUrl", () => {
  it("builds a URL for a valid request", () => {
    expect(buildEaUrl("clubInfo", q("platform=common-gen5&clubIds=914493"))).toEqual({
      ok: true,
      url: "https://proclubs.ea.com/api/fc/clubs/info?platform=common-gen5&clubIds=914493",
    });
  });

  it("accepts the optional maxResultCount only on matches, and only 1 to 10", () => {
    const ok = buildEaUrl("matches", q("platform=nx&clubIds=1&matchType=leagueMatch&maxResultCount=5"));
    expect(ok).toMatchObject({ ok: true });
    expect((ok as { url: string }).url).toMatch(/maxResultCount=5$/);
    for (const v of ["0", "11", "abc", "-1", "1.5", "100"]) {
      expect(buildEaUrl("matches", q(`platform=nx&clubIds=1&matchType=leagueMatch&maxResultCount=${v}`))).toMatchObject({ ok: false });
    }
    const other = buildEaUrl("clubInfo", q("platform=nx&clubIds=1&maxResultCount=5")) as { url: string };
    expect(other.url).not.toContain("maxResultCount");
  });

  it("rejects bad platform, ids, match type, unknown endpoints and prototype keys", () => {
    expect(buildEaUrl("clubInfo", q("platform=ps5&clubIds=1"))).toMatchObject({ ok: false });
    expect(buildEaUrl("clubInfo", q("clubIds=1"))).toMatchObject({ ok: false });
    expect(buildEaUrl("clubInfo", q("platform=nx&clubIds=abc"))).toMatchObject({ ok: false });
    expect(buildEaUrl("clubInfo", q("platform=nx&clubIds=1;DROP"))).toMatchObject({ ok: false });
    expect(buildEaUrl("matches", q("platform=nx&clubIds=1&matchType=bogus"))).toMatchObject({ ok: false });
    expect(buildEaUrl("matches", q("platform=nx&clubIds=1"))).toMatchObject({ ok: false });
    expect(buildEaUrl("search", q("platform=nx&clubName=" + "x".repeat(51)))).toMatchObject({ ok: false });
    expect(buildEaUrl("nope", q("platform=nx"))).toMatchObject({ ok: false });
    expect(buildEaUrl("__proto__", q("platform=nx"))).toMatchObject({ ok: false });
    expect(buildEaUrl("constructor", q("platform=nx"))).toMatchObject({ ok: false });
  });

  it("has ten endpoints and the three match types", () => {
    expect(Object.keys(ENDPOINTS)).toHaveLength(10);
    expect([...MATCH_TYPES]).toEqual(["leagueMatch", "playoffMatch", "friendlyMatch"]);
  });
});

describe("parsers against real EA samples", () => {
  it("every endpoint has a parser, and each parser accepts its fixture", () => {
    expect([...PARSED_ENDPOINTS].sort()).toEqual(Object.keys(ENDPOINTS).sort());
    for (const endpoint of Object.keys(ENDPOINTS)) {
      const r = parseEaResponse(endpoint, fixture(endpoint));
      expect(r.parseError, endpoint).toBeNull();
      expect(r.parsed, endpoint).not.toBeNull();
    }
  });

  it("turns EA's string numbers into numbers and keeps zero as zero", () => {
    const { members } = parseEaResponse("memberStats", fixture("memberStats.live")).parsed as { members: any[] };
    const t = members.find((m) => m.name === "T3NK_Blackpearl");
    expect(t.goals).toBe(16);
    expect(t.ratingAve).toBe(9.4);
    expect(t.prevGoals).toEqual([1, 1, 8, 2, 2, 3, 0, 0, 0, 0, 0]);
    expect(members.find((m) => m.name === "rubenvh2003").winRate).toBe(0);
  });

  it("keeps every per-match field and the event strings verbatim", () => {
    const [m] = parseEaResponse("matches", fixture("matches.twoClubs")).parsed as any[];
    expect(m.clubs["838445"]).toMatchObject({ name: "B1NHEAD FC", date: 1790789976, teamCode: 99160626, regionId: 1112101682 });
    const p = m.players["914493"][0];
    expect(p).toHaveProperty("namespace", 1);
    expect(p.eventAggregate).toHaveLength(4);
  });

  it("keeps all ten opponent ids in overallStats even when only five matches have results", () => {
    const [o] = parseEaResponse("overallStats", fixture("overallStats.991650")).parsed as any[];
    expect(o.recentMatches).toHaveLength(5);
    expect(o.opponentHistory).toHaveLength(10);
    expect(o.recentMatches.every((r: any) => r.resultCode === 2)).toBe(true);
  });

  it("parses the leaderboard rank as a number and tolerates both leaderboards", () => {
    for (const name of ["currentSeasonLeaderboard", "allTimeLeaderboard"]) {
      const [first] = parseEaResponse(name, fixture(name)).parsed as any[];
      expect(typeof first.rank).toBe("number");
      expect(first.name.length).toBeGreaterThan(0);
    }
  });

  it("degrades to parsed:null with a message instead of throwing", () => {
    expect(parseEaResponse("memberStats", { unexpected: true })).toMatchObject({ parsed: null, parseError: expect.stringContaining("members") });
    expect(parseEaResponse("matches", "garbage").parsed).toBeNull();
    expect(parseEaResponse("nope", []).parseError).toBe("no parser for this endpoint");
    expect(parseEaResponse("__proto__", []).parseError).toBe("no parser for this endpoint");
  });
});

describe("fetchEa error classification", () => {
  const respond = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  const run = async (impl: typeof fetch, endpoint = "clubInfo") => {
    const r = await fetchEa(endpoint, q("platform=common-gen5&clubIds=914493"), { fetchImpl: impl });
    return r.ok ? "ok" : `${r.kind}/${r.status}`;
  };

  it("returns ok for a good response", async () => {
    expect(await run(respond(200, JSON.stringify(fixture("clubInfo"))))).toBe("ok");
  });
  it("treats a 403 or a block page as blocked, never as data", async () => {
    expect(await run(respond(403, "{}"))).toBe("blocked/503");
    expect(await run(respond(200, "<html>Access Denied</html>"))).toBe("blocked/503");
  });
  it("classifies upstream errors, non-JSON, timeouts and network failures", async () => {
    expect(await run(respond(500, "oops"))).toBe("upstream_error/502");
    expect(await run(respond(200, "not json"))).toBe("not_json/502");
    expect(await run((async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as never)).toBe("timeout/504");
    expect(await run((async () => { throw new Error("net"); }) as never)).toBe("unreachable/504");
  });
  it("rejects a bad request before fetching anything", async () => {
    let called = false;
    const r = await fetchEa("nope", q("platform=nx"), { fetchImpl: (async () => { called = true; return new Response("[]"); }) as never });
    expect(r).toMatchObject({ ok: false, kind: "bad_request", status: 400 });
    expect(called).toBe(false);
  });
});

describe("label tables", () => {
  it("translates known codes and returns null for unknown ones", () => {
    expect(divisionLabel("6", "en")).toBe("Division 5");
    expect(divisionLabel(5, "zh")).toBe("第四組");
    expect(reputationLabel("0", "en")).toBe("Hometown Heroes");
    expect(playoffResultLabel("1", "zh")).toBe("冠軍");
    expect(positionLabel("midfielder", "zh")).toBe("中場");
    for (const bad of ["9", null, undefined, "__proto__", "constructor"]) expect(divisionLabel(bad, "en")).toBeNull();
    expect(positionLabel("striker", "en")).toBeNull();
    expect(playoffResultLabel("0", "en")).toBeNull();
  });
});
