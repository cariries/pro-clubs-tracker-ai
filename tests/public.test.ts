import { describe, expect, it } from "vitest";
import { MAX_CHOICES, PUBLIC_PLATFORMS, checkClubName, decideSearch, homePath, isClubId, isPublicPlatform, profilePath, selectPath } from "@/lib/public-clubs";
import { EA_CALLS, PUBLIC_LIMITS, admitPublic, clientKey, type GateDeps } from "@/lib/public-limit";
import { PROFILE_PARTS, loadProfile, searchClubs, type PublicDeps } from "@/lib/public-data";
import { describeHomeError, isHomeError, waitText } from "@/lib/public-text";
import { buildPublicClub } from "@/lib/club-profile";
import type { EaFetchResult } from "@/lib/ea-fetch";
import { parseEaResponse } from "@/lib/ea-parse";
import { captureClub } from "@/lib/club-capture";
import { baseEa, clone, fixture, mockEa } from "./helpers";

const club = (id: string, name: string, games: number | null = 10, over: Record<string, unknown> = {}) => ({
  clubId: id, wins: "1", losses: "1", ties: "0", gamesPlayed: games === null ? "" : String(games), goals: "1", goalsAgainst: "1", cleanSheets: "0",
  clubName: name, platform: "common-gen5", currentDivision: "5", clubInfo: { name, clubId: Number(id) }, ...over,
});

describe("checkClubName", () => {
  it("trims, collapses spaces and accepts normal names, including Chinese", () => {
    expect(checkClubName("  Test   Club ")).toEqual({ ok: true, name: "Test Club" });
    expect(checkClubName("香港 FC")).toEqual({ ok: true, name: "香港 FC" });
    expect(checkClubName("ab")).toEqual({ ok: true, name: "ab" });
  });
  it("rejects too short, too long, non-text and control characters or angle brackets", () => {
    expect(checkClubName("a")).toEqual({ ok: false, error: "too_short" });
    expect(checkClubName("   ")).toEqual({ ok: false, error: "too_short" });
    expect(checkClubName(undefined)).toEqual({ ok: false, error: "too_short" });
    expect(checkClubName(5)).toEqual({ ok: false, error: "too_short" });
    expect(checkClubName("x".repeat(51))).toEqual({ ok: false, error: "too_long" });
    expect(checkClubName("x".repeat(50))).toMatchObject({ ok: true });
    for (const bad of ["a\u0000b", "ab\u0007", "<script>alert(1)</script>", "a<b", "a>b"]) expect(checkClubName(bad), JSON.stringify(bad)).toEqual({ ok: false, error: "bad_characters" });
  });
});

describe("platform and id checks", () => {
  it("allows only the platforms EA still serves", () => {
    expect([...PUBLIC_PLATFORMS]).toEqual(["common-gen5", "nx"]);
    expect(isPublicPlatform("common-gen5")).toBe(true);
    expect(isPublicPlatform("common-gen4")).toBe(false); // EA rejects it since FC 27
    for (const bad of ["", "ps5", null, undefined, 5, "__proto__"]) expect(isPublicPlatform(bad)).toBe(false);
  });
  it("accepts only numeric club ids", () => {
    expect(isClubId("914493")).toBe(true);
    for (const bad of ["", "abc", "12a", "1;2", "../1", "1".repeat(13), null, 5]) expect(isClubId(bad), String(bad)).toBe(false);
  });
});

describe("decideSearch: none, one, or choose", () => {
  it("none for an empty result, junk, or an entry without a club id", () => {
    expect(decideSearch([])).toEqual({ kind: "none" });
    for (const junk of [null, undefined, 5, "x", {}, { members: [] }]) expect(decideSearch(junk), JSON.stringify(junk)).toEqual({ kind: "none" });
    expect(decideSearch([{}])).toEqual({ kind: "none" });
  });
  it("exactly one club goes straight to it", () => {
    const r = decideSearch([club("914493", "Test 1 team")]);
    expect(r.kind).toBe("one");
    expect(r.kind === "one" && r.club.clubId).toBe("914493");
  });
  it("the same club listed twice counts as ONE result", () => {
    expect(decideSearch([club("1", "A"), club("1", "A")]).kind).toBe("one");
  });
  it("several clubs mean choose, most games first, ties by name", () => {
    const r = decideSearch([club("1", "Beta", 5), club("2", "Alpha", 50), club("3", "Gamma", 50), club("4", "Delta", null)]);
    expect(r.kind).toBe("many");
    expect(r.kind === "many" && r.clubs.map((c) => c.name)).toEqual(["Alpha", "Gamma", "Beta", "Delta"]);
    expect(r.kind === "many" && r.total).toBe(4);
  });
  it("caps the list but still reports the true total", () => {
    const many = Array.from({ length: MAX_CHOICES + 7 }, (_, i) => club(String(i + 1), `Club ${i}`, i));
    const r = decideSearch(many);
    expect(r.kind === "many" && r.clubs.length).toBe(MAX_CHOICES);
    expect(r.kind === "many" && r.total).toBe(MAX_CHOICES + 7);
  });
  it("works on the real EA search sample", () => {
    const r = decideSearch(fixture("search"));
    expect(r.kind).toBe("many");
    expect(r.kind === "many" && r.clubs[0].name).toBe("test club ghost"); // 76 games, the most
  });
});

describe("paths", () => {
  it("encode awkward names so they cannot break out of the URL", () => {
    expect(profilePath("914493", "common-gen5")).toBe("/club/914493?platform=common-gen5");
    expect(selectPath("a b&c=d#e", "nx")).toBe("/select?name=a%20b%26c%3Dd%23e&platform=nx");
    expect(homePath("none", "x y", "nx")).toBe("/?error=none&name=x+y&platform=nx");
    expect(homePath("busy")).toBe("/?error=busy");
  });
});

describe("clientKey", () => {
  const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null });
  it("uses the first forwarded address, falling back to x-real-ip, then unknown", () => {
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientKey(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientKey(h({}))).toBe("unknown");
    expect(clientKey(h({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });
  it("never turns a hostile header into an unbounded or unsafe key", () => {
    const k = clientKey(h({ "x-forwarded-for": "evil'; DROP TABLE x;--" + "a".repeat(500) }));
    expect(k).toMatch(/^[0-9a-fA-F:.]*$/);
    expect(k.length).toBeLessThanOrEqual(45);
    expect(clientKey(h({ "x-forwarded-for": "!!!" }))).toBe("unknown");
  });
});

describe("admitPublic: breaker, then per visitor, then the global budget", () => {
  const gate = (over: Partial<{ open: boolean; visitorOk: boolean; globalOk: boolean; globalAfter: number }> = {}) => {
    const calls: string[] = [];
    let globalHits = 0;
    const deps: GateDeps = {
      breakerOpen: async () => ({ open: over.open ?? false, retryAfterSec: 120 }),
      hit: async (key, limit, windowSec) => {
        calls.push(`${key}|${limit}|${windowSec}`);
        if (key.startsWith("public:visitor:")) return { ok: over.visitorOk ?? true, retryAfterSec: 30 };
        globalHits++;
        return { ok: over.globalOk === false ? false : over.globalAfter === undefined ? true : globalHits <= over.globalAfter, retryAfterSec: 45 };
      },
    };
    return { deps, calls };
  };

  it("lets a visitor through and charges one global unit per EA call", async () => {
    const g = gate();
    expect(await admitPublic(g.deps, "1.1.1.1", EA_CALLS.profile)).toEqual({ ok: true });
    expect(g.calls.filter((c) => c.startsWith("public:global-ea"))).toHaveLength(5);
    expect(g.calls[0]).toBe(`public:visitor:1.1.1.1|${PUBLIC_LIMITS.perVisitor.limit}|${PUBLIC_LIMITS.perVisitor.windowSec}`);
  });
  it("the open breaker refuses first and touches no counter", async () => {
    const g = gate({ open: true });
    expect(await admitPublic(g.deps, "1.1.1.1", 1)).toEqual({ ok: false, reason: "breaker", retryAfterSec: 120 });
    expect(g.calls).toEqual([]);
  });
  it("a noisy visitor is refused BEFORE using any of the global budget", async () => {
    const g = gate({ visitorOk: false });
    expect(await admitPublic(g.deps, "1.1.1.1", 4)).toEqual({ ok: false, reason: "visitor", retryAfterSec: 30 });
    expect(g.calls.some((c) => c.startsWith("public:global-ea"))).toBe(false);
  });
  it("is refused when the global budget runs out partway through a multi-call page", async () => {
    const g = gate({ globalAfter: 2 });
    expect(await admitPublic(g.deps, "1.1.1.1", 4)).toEqual({ ok: false, reason: "global", retryAfterSec: 45 });
  });
  it("different visitors use different keys", async () => {
    const g = gate();
    await admitPublic(g.deps, "1.1.1.1", 1);
    await admitPublic(g.deps, "2.2.2.2", 1);
    expect(g.calls.filter((c) => c.startsWith("public:visitor:")).map((c) => c.split("|")[0])).toEqual(["public:visitor:1.1.1.1", "public:visitor:2.2.2.2"]);
  });
});

describe("public data loaders (EA and the database are fakes)", () => {
  const okSearch = (data: unknown): EaFetchResult => {
    const r = parseEaResponse("search", data);
    return { ok: true, endpoint: "search", data, parsed: r.parsed, parseError: r.parseError };
  };
  function deps(over: Partial<PublicDeps> = {}) {
    const log = { ea: [] as string[], opened: 0 };
    const d: PublicDeps = {
      breakerOpen: async () => ({ open: false, retryAfterSec: 0 }),
      hit: async () => ({ ok: true, retryAfterSec: 0 }),
      openBreaker: async () => { log.opened++; },
      fetchEa: async (endpoint, params) => { log.ea.push(`${endpoint}?${params}`); return okSearch(fixture("search")); },
      ...over,
    };
    return { d, log };
  }

  it("a search is one EA call with the right parameters and returns the decision", async () => {
    const { d, log } = deps();
    const r = await searchClubs(d, "1.1.1.1", "test", "common-gen5");
    expect(r).toMatchObject({ kind: "outcome", outcome: { kind: "many" } });
    expect(log.ea).toEqual(["search?platform=common-gen5&clubName=test"]);
  });
  it("one matching club is reported as one", async () => {
    const { d } = deps({ fetchEa: async () => okSearch([club("7", "Solo")]) });
    expect(await searchClubs(d, "v", "solo", "nx")).toMatchObject({ kind: "outcome", outcome: { kind: "one" } });
  });
  it("REGRESSION: club names survive the loader (decideSearch must read EA's raw rows, not rows already parsed)", async () => {
    const raw = fixture("search.law");
    const two = [raw[0], { ...clone(raw[0]), clubId: "716237", clubName: "Second Club", clubInfo: { name: "Second Club", clubId: 716237 } }];
    const many = await searchClubs(deps({ fetchEa: async () => okSearch(two) }).d, "v", "law", "common-gen5");
    expect(many).toMatchObject({ kind: "outcome", outcome: { kind: "many" } });
    expect(many.kind === "outcome" && many.outcome.kind === "many" && many.outcome.clubs.map((c) => c.name).sort()).toEqual(["Law and Order1", "Second Club"]);
    const one = await searchClubs(deps({ fetchEa: async () => okSearch(raw) }).d, "v", "law", "common-gen5");
    expect(one.kind === "outcome" && one.outcome.kind === "one" && one.outcome.club).toMatchObject({ clubId: "621365", name: "Law and Order1", gamesPlayed: 7, wins: 1, ties: 2, losses: 4, currentDivision: 6, reputationTier: 0 });
  });
  it("a club whose name is only in clubInfo.name still shows its name", async () => {
    const raw = clone(fixture("search.law")); delete raw[0].clubName;
    const r = await searchClubs(deps({ fetchEa: async () => okSearch(raw) }).d, "v", "law", "common-gen5");
    expect(r.kind === "outcome" && r.outcome.kind === "one" && r.outcome.club.name).toBe("Law and Order1");
  });
  it("makes NO EA call when the visitor is refused or the breaker is open", async () => {
    const a = deps({ hit: async () => ({ ok: false, retryAfterSec: 9 }) });
    expect(await searchClubs(a.d, "v", "test", "nx")).toMatchObject({ kind: "refused", gate: { reason: "visitor" } });
    expect(a.log.ea).toEqual([]);
    const b = deps({ breakerOpen: async () => ({ open: true, retryAfterSec: 200 }) });
    expect(await searchClubs(b.d, "v", "test", "nx")).toMatchObject({ kind: "refused", gate: { reason: "breaker", retryAfterSec: 200 } });
    expect(b.log.ea).toEqual([]);
  });
  it("an EA block opens the breaker; other EA errors do not", async () => {
    const blocked = deps({ fetchEa: async () => ({ ok: false, kind: "blocked", status: 503, body: {} }) });
    expect(await searchClubs(blocked.d, "v", "test", "nx")).toEqual({ kind: "ea_error", blocked: true });
    expect(blocked.log.opened).toBe(1);
    for (const kind of ["timeout", "unreachable", "upstream_error", "not_json"] as const) {
      const other = deps({ fetchEa: async () => ({ ok: false, kind, status: 502, body: {} }) });
      expect(await searchClubs(other.d, "v", "test", "nx")).toEqual({ kind: "ea_error", blocked: false });
      expect(other.log.opened, kind).toBe(0);
    }
  });
  it("treats a response that cannot be parsed as no result, not a crash", async () => {
    const { d } = deps({ fetchEa: async () => ({ ok: true, endpoint: "search", data: {}, parsed: null, parseError: "expected an array" }) });
    expect(await searchClubs(d, "v", "test", "nx")).toEqual({ kind: "outcome", outcome: { kind: "none" } });
  });

  const profileEa = (over: Record<string, EaFetchResult | undefined> = {}) => async (endpoint: string, params: URLSearchParams): Promise<EaFetchResult> => {
    const forced = over[endpoint];
    if (forced) return forced;
    return (await mockEa(baseEa())(endpoint, params)) as EaFetchResult;
  };
  it("a profile fetches five parts: the four season parts plus the newest 10 LEAGUE matches, and never playoffs or friendlies", async () => {
    const seen: string[] = [];
    const urls: string[] = [];
    const { d } = deps({ fetchEa: async (e, p) => { seen.push(e); urls.push(`${e}?${p}`); return profileEa()(e, p); } });
    const r = await loadProfile(d, "v", "914493", "common-gen5");
    expect(r.kind).toBe("ok");
    expect(seen.sort()).toEqual(["clubInfo", "matches", "memberCareerStats", "memberStats", "overallStats"]);
    const m = urls.filter((u) => u.startsWith("matches?"));
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("matchType=leagueMatch");
    expect(m[0]).toContain("maxResultCount=10");
    expect(urls.join(" ")).not.toMatch(/playoffMatch|friendlyMatch/);
    expect([...PROFILE_PARTS]).toHaveLength(EA_CALLS.profile); // the rate-limit charge matches the number of EA calls
  });
  it("an unknown club (no club info, no totals) is not found", async () => {
    const empty = (endpoint: string): EaFetchResult => ({ ok: true, endpoint, data: [], parsed: [], parseError: null });
    const { d } = deps({ fetchEa: profileEa({ clubInfo: empty("clubInfo"), overallStats: empty("overallStats"), memberStats: { ok: true, endpoint: "memberStats", data: { members: [] }, parsed: { members: [], positionCount: {} }, parseError: null }, memberCareerStats: { ok: true, endpoint: "memberCareerStats", data: { members: [] }, parsed: { members: [], positionCount: {} }, parseError: null } }) });
    expect(await loadProfile(d, "v", "1", "nx")).toEqual({ kind: "not_found" });
  });
  it("a block on any part opens the breaker and no page is shown", async () => {
    const { d, log } = deps({ fetchEa: profileEa({ memberStats: { ok: false, kind: "blocked", status: 503, body: {} } }) });
    expect(await loadProfile(d, "v", "914493", "common-gen5")).toEqual({ kind: "ea_error", blocked: true });
    expect(log.opened).toBe(1);
  });
  it("EA being down for the key parts is an EA error, not 'not found' (a wrong id must not look like an outage, nor the reverse)", async () => {
    const fail: EaFetchResult = { ok: false, kind: "timeout", status: 504, body: {} };
    const emptyMembers = (endpoint: string): EaFetchResult => ({ ok: true, endpoint, data: { members: [] }, parsed: { members: [], positionCount: {} }, parseError: null });
    const { d } = deps({ fetchEa: profileEa({ clubInfo: fail, overallStats: fail, memberStats: emptyMembers("memberStats"), memberCareerStats: emptyMembers("memberCareerStats") }) });
    expect(await loadProfile(d, "v", "914493", "common-gen5")).toEqual({ kind: "ea_error", blocked: false });
  });

  it("when the key parts did not load but another part DID, a failure still means EA trouble, not 'no such club'", async () => {
    const fail: EaFetchResult = { ok: false, kind: "timeout", status: 504, body: {} };
    const noData = (endpoint: string, data: unknown, parsed: unknown): EaFetchResult => ({ ok: true, endpoint, data, parsed, parseError: null });
    // club info and totals are EMPTY (not ok), members FAILED, career has data: okCount > 0, key parts not ok, one failure
    const { d } = deps({
      fetchEa: profileEa({
        clubInfo: noData("clubInfo", {}, []),
        overallStats: noData("overallStats", [], []),
        memberStats: fail,
        memberCareerStats: noData("memberCareerStats", { members: [{ name: "X", gamesPlayed: "1" }] }, { members: [{ name: "X", gamesPlayed: 1 }], positionCount: {} }),
      }),
    });
    expect(await loadProfile(d, "v", "914493", "common-gen5")).toEqual({ kind: "ea_error", blocked: false });
  });

  it("the same shape with NOTHING failed is 'no such club'", async () => {
    const noData = (endpoint: string, data: unknown, parsed: unknown): EaFetchResult => ({ ok: true, endpoint, data, parsed, parseError: null });
    const { d } = deps({
      fetchEa: profileEa({
        clubInfo: noData("clubInfo", {}, []),
        overallStats: noData("overallStats", [], []),
        memberStats: noData("memberStats", { members: [] }, { members: [], positionCount: {} }),
        memberCareerStats: noData("memberCareerStats", { members: [{ name: "X", gamesPlayed: "1" }] }, { members: [{ name: "X", gamesPlayed: 1 }], positionCount: {} }),
      }),
    });
    expect(await loadProfile(d, "v", "914493", "common-gen5")).toEqual({ kind: "not_found" });
  });

  it("all parts failing is an EA error, not 'not found'", async () => {
    const fail: EaFetchResult = { ok: false, kind: "timeout", status: 504, body: {} };
    const { d } = deps({ fetchEa: async () => fail });
    expect(await loadProfile(d, "v", "914493", "common-gen5")).toEqual({ kind: "ea_error", blocked: false });
  });
  it("is refused (no EA call) when the global budget is spent", async () => {
    const { d, log } = deps({ hit: async (key) => ({ ok: !key.startsWith("public:global"), retryAfterSec: 15 }) });
    expect(await loadProfile(d, "v", "914493", "common-gen5")).toMatchObject({ kind: "refused", gate: { reason: "global" } });
    expect(log.ea).toEqual([]);
  });
});

describe("buildPublicClub", () => {
  async function cap() {
    return captureClub("914493", "common-gen5", { fetchEa: mockEa(baseEa()) as never }, new Date("2026-11-13T10:00:00Z"), ["clubInfo", "overallStats", "memberStats", "memberCareerStats"]);
  }
  it("shows the record, rates and every member, using the same numbers as Ask AI", async () => {
    const c = buildPublicClub(await cap(), "914493", "common-gen5");
    expect(c.profile.name).toBe("Test 1 team");
    expect(c.profile.record).toMatchObject({ games: 5, wins: 3, ties: 2, losses: 0, goals: 23, goalsAgainst: 11 });
    expect(c.winRate).toBe(60);
    expect(c.goalsForPerGame).toBe(4.6);
    expect(c.goalsAgainstPerGame).toBe(2.2);
    expect(c.members.map((m) => m.name)).toEqual(["T3NK_Blackpearl", "Kale_Karel10", "rubenvh2003"]);
    expect(c.members[0]).toMatchObject({ goals: 16, careerGoals: 47, passPct: 87, ranked: true });
    expect(c.stadium).toBe("Rang 1-stadion");
    expect(c.thin).toBe(true); // 5 games
    expect(c.failedParts).toEqual([]);
  });
  it("matches and playoffs, which a public view does not fetch, are not reported as failures", async () => {
    const c = buildPublicClub(await cap(), "914493", "common-gen5");
    expect(c.failedParts).not.toContain("leagueMatches");
    expect(c.profile.recentForm).toBeNull();
  });
  it("lists a failed part and does not crash on unreadable data", async () => {
    const data = baseEa();
    data.members = { oops: true };
    const c = await captureClub("914493", "common-gen5", { fetchEa: mockEa(data) as never }, new Date(), PROFILE_PARTS);
    const built = buildPublicClub(c, "914493", "common-gen5");
    expect(built.failedParts).toContain("memberStats");
    expect(built.members).toEqual([]);
    expect(() => buildPublicClub({ ...c, payload: clone(c.payload) }, "914493", "nx")).not.toThrow();
  });
});

describe("home page wording", () => {
  it("has English and Cantonese for every code and ignores unknown ones", () => {
    for (const code of ["too_short", "too_long", "bad_characters", "bad_platform", "none", "busy", "blocked", "ea", "unavailable"]) {
      expect(isHomeError(code)).toBe(true);
      const t = describeHomeError(code)!;
      expect(t.en.length, code).toBeGreaterThan(10);
      expect(/[㐀-鿿]/.test(t.zh), `${code} zh`).toBe(true);
      expect(t.en + t.zh).not.toMatch(/\{retry\}|undefined|NaN/);
    }
    for (const bad of ["", "<script>", "__proto__", "constructor", "toString", "NONE"]) expect(describeHomeError(bad), bad).toBeNull();
  });
  it("puts the wait time into the busy message, with sane fallbacks", () => {
    expect(describeHomeError("busy", "45")!.en).toContain("45 seconds");
    expect(describeHomeError("busy", "300")!.en).toContain("5 minutes");
    expect(describeHomeError("busy", "300")!.zh).toContain("5 分鐘");
    for (const bad of ["abc", "-5", "0", "", undefined, "999999999"]) expect(describeHomeError("busy", bad)!.en, String(bad)).toContain("60 seconds");
  });
  it("formats waits", () => {
    expect(waitText(1).en).toBe("1 second");
    expect(waitText(89).en).toBe("89 seconds");
    expect(waitText(90).en).toBe("2 minutes");
    expect(waitText(0).en).toBe("1 second");
  });
});

import { clubRowLabel } from "@/lib/public-clubs";
describe("clubRowLabel (a row in the choose list is never unidentifiable)", () => {
  it("shows the name and always the club ID", () => {
    expect(clubRowLabel({ name: "Test 1 team", clubId: "914493" })).toEqual({ name: "Test 1 team", nameMissing: false, idText: "ID 914493" });
  });
  it("a blank or whitespace name falls back to the ID and says the name is missing", () => {
    for (const name of ["", "   ", "\n\t"]) expect(clubRowLabel({ name, clubId: "7" }), JSON.stringify(name)).toEqual({ name: "Club 7", nameMissing: true, idText: "ID 7" });
  });
  it("a name made only of invisible characters counts as missing (it is not empty, yet shows as blank)", () => {
    for (const name of ["\u200B", "\u200B\u200D\uFEFF", "\u2800\u2800", "\u3164", "\u00A0\u2003", "\u202E"]) {
      expect(clubRowLabel({ name, clubId: "9" }), JSON.stringify(name)).toMatchObject({ name: "Club 9", nameMissing: true });
    }
  });
  it("keeps visible text around invisible characters, and never strips real letters, digits, emoji or Chinese", () => {
    expect(clubRowLabel({ name: "A\u200BB", clubId: "1" }).name).toBe("A B");
    for (const name of ["Zeta 99", "香港隊", "Équipe ⚽", "العربية", "x"]) expect(clubRowLabel({ name, clubId: "1" })).toMatchObject({ name, nameMissing: false });
  });
  it("tidies inner whitespace, and keeps Chinese names", () => {
    expect(clubRowLabel({ name: "  香港   FC ", clubId: "1" }).name).toBe("香港 FC");
  });
});
