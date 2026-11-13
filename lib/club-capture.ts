// Club capture: the EA calls for one club, kept as PARSED data only (never EA's raw JSON). A part that fails is
// recorded as failed and the rest are still kept, so one flaky EA call does not lose the whole club. The result is
// shared through the 15-minute club cache (lib/club-cache.ts); nothing is kept per user.
import { fetchEa as defaultFetchEa, type EaFetchResult } from "./ea-fetch";

/** Asked of EA via maxResultCount. Unconfirmed that EA honours it, so don't rely on the count. */
export const MATCHES_PER_PART = 10;

export type PartStatus = "ok" | "empty" | "failed";
export interface CapturePart {
  status: PartStatus;
  /** Why a part failed (failure kind, and EA's HTTP status where known). Never EA's body. */
  error?: string;
  /** Parsed endpoint result (see ea-types.ts). Present only when status is "ok". */
  data?: unknown;
}

export const PART_KEYS = [
  "clubInfo",
  "overallStats",
  "memberStats",
  "memberCareerStats",
  "leagueMatches",
  "playoffMatches",
] as const;
export type PartKey = (typeof PART_KEYS)[number];

interface PartDef {
  key: PartKey;
  endpoint: string;
  params: (clubId: string, platform: string) => URLSearchParams;
}

const PARTS: PartDef[] = [
  { key: "clubInfo", endpoint: "clubInfo", params: (c, p) => new URLSearchParams({ platform: p, clubIds: c }) },
  { key: "overallStats", endpoint: "overallStats", params: (c, p) => new URLSearchParams({ platform: p, clubIds: c }) },
  { key: "memberStats", endpoint: "memberStats", params: (c, p) => new URLSearchParams({ platform: p, clubId: c }) },
  { key: "memberCareerStats", endpoint: "memberCareerStats", params: (c, p) => new URLSearchParams({ platform: p, clubId: c }) },
  {
    key: "leagueMatches",
    endpoint: "matches",
    params: (c, p) =>
      new URLSearchParams({ platform: p, clubIds: c, matchType: "leagueMatch", maxResultCount: String(MATCHES_PER_PART) }),
  },
  {
    key: "playoffMatches",
    endpoint: "matches",
    params: (c, p) =>
      new URLSearchParams({ platform: p, clubIds: c, matchType: "playoffMatch", maxResultCount: String(MATCHES_PER_PART) }),
  },
];

function isEmptyResult(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (typeof parsed === "object" && parsed !== null && "members" in parsed) {
    const m = (parsed as { members: unknown }).members;
    return Array.isArray(m) && m.length === 0;
  }
  return false;
}

function toPart(r: EaFetchResult): CapturePart {
  if (!r.ok) {
    const up = r.body.upstreamStatus;
    return { status: "failed", error: up !== undefined ? `${r.kind} (HTTP ${String(up)})` : r.kind };
  }
  if (r.parseError !== null) return { status: "failed", error: `parse: ${r.parseError}` };
  if (isEmptyResult(r.parsed)) return { status: "empty" };
  return { status: "ok", data: r.parsed };
}

/** What a capture holds (and what the club cache stores). */
export interface CapturePayload {
  capturedAt: string;
  /** Newest match timestamp (unix seconds) across league and playoff matches, to show how fresh EA's data was. */
  newestMatchTimestamp: number | null;
  parts: Record<PartKey, CapturePart>;
}

/** A small digest of a capture (part statuses, counts, bytes), so callers need not walk the full payload. */
export interface CaptureSummary {
  statuses: Record<PartKey, PartStatus>;
  clubName: string | null;
  memberCount: number;
  leagueMatchCount: number;
  playoffMatchCount: number;
  newestMatchTimestamp: number | null;
  bytes: number;
}

export interface CaptureResult {
  payload: CapturePayload;
  summary: CaptureSummary;
  /** True if any EA call looked blocked. Surface this to the user; never retry or work around it. */
  blocked: boolean;
  okCount: number;
}

function arrLen(part: CapturePart): number {
  return part.status === "ok" && Array.isArray(part.data) ? part.data.length : 0;
}

function newestTimestamp(...parts: CapturePart[]): number | null {
  let newest: number | null = null;
  for (const p of parts) {
    if (p.status !== "ok" || !Array.isArray(p.data)) continue;
    for (const m of p.data as Array<{ timestamp?: number | null }>) {
      if (typeof m.timestamp === "number" && (newest === null || m.timestamp > newest)) newest = m.timestamp;
    }
  }
  return newest;
}

export async function captureClub(
  clubId: string,
  platform: string,
  deps: { fetchEa: typeof defaultFetchEa } = { fetchEa: defaultFetchEa },
  now: Date = new Date(),
  /** Fetch only these parts (default: all six). Used by the public club page, which needs four. Skipped parts are recorded as empty. */
  only?: readonly PartKey[],
): Promise<CaptureResult> {
  const wanted = PARTS.filter((d) => !only || only.includes(d.key));
  const results = await Promise.all(
    wanted.map(async (def) => [def.key, await deps.fetchEa(def.endpoint, def.params(clubId, platform))] as const),
  );

  const parts = Object.fromEntries(PART_KEYS.map((k) => [k, { status: "empty" } as CapturePart])) as Record<PartKey, CapturePart>;
  let blocked = false;
  for (const [key, r] of results) {
    parts[key] = toPart(r);
    if (!r.ok && r.kind === "blocked") blocked = true;
  }

  const newestMatchTimestamp = newestTimestamp(parts.leagueMatches, parts.playoffMatches);
  const payload: CapturePayload = { capturedAt: now.toISOString(), newestMatchTimestamp, parts };

  const info = parts.clubInfo.status === "ok" ? (parts.clubInfo.data as Array<{ name?: string | null }>) : [];
  const members =
    parts.memberStats.status === "ok" ? (parts.memberStats.data as { members?: unknown[] }).members : undefined;
  const summary: CaptureSummary = {
    statuses: Object.fromEntries(PART_KEYS.map((k) => [k, parts[k].status])) as Record<PartKey, PartStatus>,
    clubName: info[0]?.name ?? null,
    memberCount: Array.isArray(members) ? members.length : 0,
    leagueMatchCount: arrLen(parts.leagueMatches),
    playoffMatchCount: arrLen(parts.playoffMatches),
    newestMatchTimestamp,
    bytes: Buffer.byteLength(JSON.stringify(payload)),
  };

  return { payload, summary, blocked, okCount: PART_KEYS.filter((k) => parts[k].status === "ok").length };
}
