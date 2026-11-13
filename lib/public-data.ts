// Server-side loaders for the public pages. They gate every EA call through admitPublic, and report a block to
// the circuit breaker. Anything that touches EA or the database is injected so the logic is testable.
import { clientKey, admitPublic, BREAKER_KEY, EA_CALLS, PUBLIC_LIMITS, type GateDeps, type PublicGate } from "./public-limit";
import { decideSearch, type SearchOutcome } from "./public-clubs";
import type { EaFetchResult } from "./ea-fetch";
import { captureClub, type CaptureResult } from "./club-capture";

/** The parts the public club page shows. Matches and playoffs are left out on purpose: fewer EA calls per view. */
export const PROFILE_PARTS = ["clubInfo", "overallStats", "memberStats", "memberCareerStats"] as const;

export interface PublicDeps extends GateDeps {
  fetchEa(endpoint: string, params: URLSearchParams): Promise<EaFetchResult>;
  /** Opens the circuit breaker for PUBLIC_LIMITS.breakerSeconds. */
  openBreaker(): Promise<void>;
}

export type SearchResult =
  | { kind: "outcome"; outcome: SearchOutcome }
  | { kind: "refused"; gate: Extract<PublicGate, { ok: false }> }
  | { kind: "ea_error"; blocked: boolean };

/** Searches clubs by name for an anonymous visitor. One EA call, after the limits and the breaker. */
export async function searchClubs(deps: PublicDeps, visitor: string, name: string, platform: string): Promise<SearchResult> {
  const gate = await admitPublic(deps, visitor, EA_CALLS.search);
  if (!gate.ok) return { kind: "refused", gate };

  const r = await deps.fetchEa("search", new URLSearchParams({ platform, clubName: name }));
  if (!r.ok) {
    const blocked = r.kind === "blocked";
    if (blocked) await deps.openBreaker();
    return { kind: "ea_error", blocked };
  }
  if (r.parseError !== null) return { kind: "outcome", outcome: { kind: "none" } };
  // decideSearch parses EA's RAW rows itself. `r.parsed` is ALREADY parsed (it has `name`, not `clubName`), so parsing
  // it again produced blank club names on the choose page (found 2026-11-13). Always pass the raw data.
  return { kind: "outcome", outcome: decideSearch(r.data) };
}

export type ProfileResult =
  | { kind: "ok"; cap: CaptureResult }
  | { kind: "refused"; gate: Extract<PublicGate, { ok: false }> }
  | { kind: "ea_error"; blocked: boolean }
  | { kind: "not_found" };

/** Loads a club's public profile: four EA calls, after the limits and the breaker. Nothing is stored. */
export async function loadProfile(deps: PublicDeps, visitor: string, clubId: string, platform: string): Promise<ProfileResult> {
  const gate = await admitPublic(deps, visitor, EA_CALLS.profile);
  if (!gate.ok) return { kind: "refused", gate };

  const cap = await captureClub(clubId, platform, { fetchEa: (e, p) => deps.fetchEa(e, p) }, new Date(), PROFILE_PARTS);
  if (cap.blocked) {
    await deps.openBreaker();
    return { kind: "ea_error", blocked: true };
  }
  const st = cap.summary.statuses;
  const failed = PROFILE_PARTS.filter((k) => st[k] === "failed").length;
  // EA answers an unknown club id with empty data, not an error: nothing usable and nothing failed means "no such club".
  // If anything FAILED, EA (or the network) is the problem, not the club.
  if (cap.okCount === 0) return failed > 0 ? { kind: "ea_error", blocked: false } : { kind: "not_found" };
  // Some parts worked but neither the club info nor the record did: not a club we can show.
  if (st.clubInfo !== "ok" && st.overallStats !== "ok") return failed > 0 ? { kind: "ea_error", blocked: false } : { kind: "not_found" };
  return { kind: "ok", cap };
}

export { clientKey, BREAKER_KEY, PUBLIC_LIMITS };
