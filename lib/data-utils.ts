// Small pure helpers for reading captured club data and formatting dates. No React, no server-only imports.
// Captured data may come from an older or newer parser version, so everything is read defensively: a missing or
// oddly shaped part yields null/empty, never a throw.
import type { PartKey, PartStatus } from "./club-capture";

export type { Bi } from "./i18n";
import type { Bi } from "./i18n";

export const STATUS_LABEL: Record<PartStatus, Bi> = {
  ok: { en: "OK", zh: "成功" },
  empty: { en: "No data", zh: "冇資料" },
  failed: { en: "Failed", zh: "失敗" },
};

export const PART_LABEL: Record<PartKey, Bi> = {
  clubInfo: { en: "Club info", zh: "球會資料" },
  overallStats: { en: "Club totals", zh: "球會整體數據" },
  memberStats: { en: "Players, this season", zh: "球員(本季)" },
  memberCareerStats: { en: "Players, career", zh: "球員(生涯)" },
  leagueMatches: { en: "League matches", zh: "聯賽賽事" },
  playoffMatches: { en: "Playoff matches", zh: "季後賽賽事" },
};

const PART_ORDER = Object.keys(PART_LABEL) as PartKey[];

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Unix seconds -> "2026-09-30 17:39 UTC" (UTC on purpose: same output on server and browser). */
export function formatUnix(ts: number | null | undefined): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function formatIso(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/** Whole days between EA's newest match and the moment we captured it. Null if either is unknown. */
export function dataAgeDays(capturedAtIso: string | null, newestMatchTs: number | null): number | null {
  if (!capturedAtIso || newestMatchTs === null) return null;
  const captured = new Date(capturedAtIso).getTime();
  if (Number.isNaN(captured)) return null;
  return Math.max(0, Math.floor((captured - newestMatchTs * 1000) / 86_400_000));
}

export function partOf(parts: unknown, key: PartKey): { status: PartStatus | null; error: string | null; data: unknown } {
  const p = isObj(parts) ? parts[key] : undefined;
  if (!isObj(p)) return { status: null, error: null, data: undefined };
  const status = p.status === "ok" || p.status === "empty" || p.status === "failed" ? p.status : null;
  return { status, error: str(p.error), data: p.data };
}
