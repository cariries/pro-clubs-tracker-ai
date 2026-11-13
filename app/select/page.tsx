import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { addAskClub, askPath, formatAskClubs, parseAskClubs } from "@/lib/ask-clubs";
import { fetchEa } from "@/lib/ea-fetch";
import { checkClubName, clubRowLabel, homePath, isPublicPlatform, profilePath } from "@/lib/public-clubs";
import { clientKey, searchClubs } from "@/lib/public-data";
import { openBreaker, realGate } from "@/lib/public-db";
import { divisionLabel } from "@/lib/ea-labels";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Public: no login. Several clubs matched the name; the visitor chooses one. The search is repeated here (EA's
// answer is cached for 5 minutes) so this page works when opened directly or refreshed.
export default async function SelectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rawName = typeof sp.name === "string" ? sp.name : "";
  const platform = typeof sp.platform === "string" ? sp.platform : "";
  const fromAsk = typeof sp.clubs === "string";
  const ask = parseAskClubs(sp.clubs);
  const name = checkClubName(rawName);
  if (!name.ok) redirect(homePath(name.error, rawName.slice(0, 50), platform));
  if (!isPublicPlatform(platform)) redirect(homePath("bad_platform", name.name));
  if (!process.env.DATABASE_URL) redirect(homePath("unavailable", name.name, platform));

  const h = await headers();
  const r = await searchClubs({ ...realGate(), openBreaker, fetchEa: (e, p) => fetchEa(e, p, { revalidate: 300 }) }, clientKey(h), name.name, platform);
  if (r.kind === "refused") redirect(`${homePath(r.gate.reason === "breaker" ? "blocked" : "busy", name.name, platform)}&retry=${r.gate.retryAfterSec}`);
  if (r.kind === "ea_error") redirect(homePath(r.blocked ? "blocked" : "ea", name.name, platform));
  if (r.outcome.kind === "none") redirect(homePath("none", name.name, platform));
  if (r.outcome.kind === "one") redirect(fromAsk ? askPath(addAskClub(ask, { clubId: r.outcome.club.clubId, platform }).clubs) : profilePath(r.outcome.club.clubId, platform));

  const { clubs, total } = r.outcome;
  return (
    <main>
      <h1>Choose a club / 揀選球會</h1>
      <p className="muted">
        {total} clubs match this name; most games played first. / 有 {total} 個球會符合呢個名稱,以出賽場數多至少排列。
      </p>
      <div className="card">
        <ul className="list">
          {clubs.map((c) => {
            const div = divisionLabel(c.currentDivision, "en");
            const divZh = divisionLabel(c.currentDivision, "zh");
            const row = clubRowLabel(c);
            return (
              <li key={c.clubId}>
                <span>
                  <strong>{row.name}</strong>{" "}
                  <span className="muted">
                    · {row.idText}
                    {row.nameMissing ? " · EA gave no name / EA 冇提供名稱" : ""} · {c.gamesPlayed ?? "–"} games / 場 · {c.wins ?? "–"}W {c.ties ?? "–"}D {c.losses ?? "–"}L
                    {div ? ` · ${div} / ${divZh}` : ""}
                  </span>
                </span>
                <a className="button" href={fromAsk ? askPath(addAskClub(ask, { clubId: c.clubId, platform }).clubs) : profilePath(c.clubId, platform)}>
                  {fromAsk ? "Add to Ask AI / 加入問 AI" : "View / 查看"}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      {total > clubs.length && (
        <p className="muted">
          Showing the first {clubs.length}. Narrow the name to see others. / 只顯示頭 {clubs.length} 個,請輸入更精確嘅名稱。
        </p>
      )}
      <p>
        <a href={fromAsk ? askPath(ask) : "/"}>{fromAsk ? "← Back to Ask AI / 返回問 AI" : "← Search again / 重新搜尋"}</a>
      </p>
    </main>
  );
}
