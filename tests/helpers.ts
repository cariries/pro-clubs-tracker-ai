// Shared test helpers: fixture loading and building REAL snapshot payloads with the real capture code
// and a mocked EA, so the tests exercise genuine output shapes rather than hand-written look-alikes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEaResponse } from "@/lib/ea-parse";
import { captureClub, type CaptureResult } from "@/lib/club-capture";

export function fixture<T = any>(name: string): T {
  const path = fileURLToPath(new URL(`../fixtures/${name}.sample.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export interface EaData {
  members: any;
  matches: any;
  overall: any;
}

export const baseEa = (): EaData => ({
  members: clone(fixture("memberStats.live")),
  matches: clone(fixture("matches.twoClubs")),
  overall: clone(fixture("overallStats")),
});

/** A mocked EA that serves the given data for the three varying endpoints and fixtures for the rest. */
export function mockEa(data: EaData) {
  return async (endpoint: string, params: URLSearchParams) => {
    const body =
      endpoint === "matches" ? (params.get("matchType") === "playoffMatch" ? [] : data.matches)
      : endpoint === "memberStats" ? data.members
      : endpoint === "overallStats" ? data.overall
      : fixture(endpoint);
    const r = parseEaResponse(endpoint, body);
    return { ok: true as const, endpoint, data: body, parsed: r.parsed, parseError: r.parseError };
  };
}

export async function capture(data: EaData, at: string): Promise<CaptureResult> {
  return captureClub("914493", "common-gen5", { fetchEa: mockEa(data) as never }, new Date(at));
}

export const ID1 = "11111111-1111-4111-8111-111111111111";
export const ID2 = "22222222-2222-4222-8222-222222222222";
export const ID3 = "33333333-3333-4333-8333-333333333333";
