import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { buildPublicClub } from "@/lib/club-profile";
import { describeWarning } from "@/lib/club-compare";
import { fetchEa } from "@/lib/ea-fetch";
import { askPath } from "@/lib/ask-clubs";
import { homePath, isClubId, isPublicPlatform } from "@/lib/public-clubs";
import { clientKey, loadProfile } from "@/lib/public-data";
import { openBreaker, realGate } from "@/lib/public-db";
import { formatUnix } from "@/lib/data-utils";
import Stat from "@/components/Stat";
import ChartView from "@/components/ChartView";
import { chartsFor } from "@/lib/charts";
import { getLang } from "@/lib/lang-server";
import { fill, pick } from "@/lib/i18n";
import { CLUB } from "@/lib/ui-text";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
const n = (v: number | null) => (v === null ? "–" : String(v));

// Public: no login. The club's record and every member, fetched live from EA (cached 5 minutes), nothing stored.
export default async function ClubPage({ params, searchParams }: { params: Promise<{ clubId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lang = await getLang();
  const { clubId } = await params;
  const sp = await searchParams;
  const platform = typeof sp.platform === "string" ? sp.platform : "common-gen5";
  if (!isClubId(clubId) || !isPublicPlatform(platform)) notFound();
  if (!process.env.DATABASE_URL) redirect(homePath("unavailable"));

  const h = await headers();
  const r = await loadProfile({ ...realGate(), openBreaker, fetchEa: (e, p) => fetchEa(e, p, { revalidate: 300 }) }, clientKey(h), clubId, platform);

  if (r.kind === "refused") redirect(`${homePath(r.gate.reason === "breaker" ? "blocked" : "busy")}&retry=${r.gate.retryAfterSec}`);
  if (r.kind === "ea_error") redirect(homePath(r.blocked ? "blocked" : "ea"));
  if (r.kind === "not_found") notFound();

  const club = buildPublicClub(r.cap, clubId, platform);
  const p = club.profile;
  const rec = p.record;
  const name = p.name ?? `Club ${clubId}`;
  const warnings = [
    ...(club.thin ? [fill(pick(CLUB.thin, lang), { games: rec?.games ?? 0 })] : []),
    ...(club.dataAgeDays !== null && club.dataAgeDays > 14 ? [pick(describeWarning({ code: "stale_data", club: name, days: club.dataAgeDays }), lang)] : []),
    ...(club.failedParts.length > 0 ? [pick(CLUB.partial, lang)] : []),
  ];

  return (
    <main>
      <h1>{name}</h1>
      <p className="muted">
        {pick(platform === "common-gen5" ? CLUB.platformGen5 : CLUB.platformNx, lang)} · {pick(CLUB.clubId, lang)} {clubId}
        {club.newestMatchAt ? <> · {pick(CLUB.newestMatch, lang)} {club.newestMatchAt}</> : null}
      </p>
      {warnings.map((w, i) => (
        <div className="notice" key={i}>
          {w}
        </div>
      ))}

      {rec ? (
        <section>
          <h2>{pick(CLUB.recordTitle, lang)}</h2>
          <div className="stats">
            <Stat k={pick(CLUB.played, lang)} v={n(rec.games)} />
            <Stat k={pick(CLUB.win, lang)} v={n(rec.wins)} />
            <Stat k={pick(CLUB.draw, lang)} v={n(rec.ties)} />
            <Stat k={pick(CLUB.loss, lang)} v={n(rec.losses)} />
            <Stat k={pick(CLUB.winRate, lang)} v={pct(club.winRate)} />
            <Stat k={pick(CLUB.gfpg, lang)} v={n(club.goalsForPerGame)} />
            <Stat k={pick(CLUB.gapg, lang)} v={n(club.goalsAgainstPerGame)} />
            <Stat k={pick(CLUB.skill, lang)} v={n(p.skillRating)} />
          </div>
        </section>
      ) : (
        <div className="notice">{pick(CLUB.noRecord, lang)}</div>
      )}

      <section>
        <h2>{pick(CLUB.members, lang)} ({club.members.length})</h2>
        {club.members.length === 0 ? (
          <p className="muted">{pick(CLUB.noMembers, lang)}</p>
        ) : (
          <div className="card tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{pick(CLUB.colName, lang)}</th>
                  <th>{pick(CLUB.colPos, lang)}</th>
                  <th>{pick(CLUB.colGp, lang)}</th>
                  <th>{pick(CLUB.colG, lang)}</th>
                  <th>{pick(CLUB.colA, lang)}</th>
                  <th>{pick(CLUB.colGpg, lang)}</th>
                  <th>{pick(CLUB.colRating, lang)}</th>
                  <th>{pick(CLUB.colPass, lang)}</th>
                  <th>{pick(CLUB.colShot, lang)}</th>
                  <th>{pick(CLUB.colTackle, lang)}</th>
                  <th>{pick(CLUB.colMotm, lang)}</th>
                  <th>{pick(CLUB.colCareerGp, lang)}</th>
                  <th>{pick(CLUB.colCareerG, lang)}</th>
                </tr>
              </thead>
              <tbody>
                {club.members.map((m) => (
                  <tr key={m.name} className={m.ranked ? undefined : "dim"}>
                    <td>
                      {m.name}
                      {m.ranked ? "" : " *"}
                    </td>
                    <td>{m.pos ?? "–"}</td>
                    <td>{n(m.games)}</td>
                    <td>{n(m.goals)}</td>
                    <td>{n(m.assists)}</td>
                    <td>{n(m.goalsPerGame)}</td>
                    <td>{n(m.rating)}</td>
                    <td>{pct(m.passPct)}</td>
                    <td>{pct(m.shotPct)}</td>
                    <td>{pct(m.tacklePct)}</td>
                    <td>{n(m.motm)}</td>
                    <td>{n(m.careerGames)}</td>
                    <td>{n(m.careerGoals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          <small>{pick(CLUB.footnote, lang)}</small>
        </p>
      </section>

      <ChartView charts={chartsFor({ mode: "single", clubs: [p], metrics: [] })} lang={lang} />

      <section className="card">
        <h3>{pick(CLUB.askTitle, lang)}</h3>
        <p>
          <a className="button" href={askPath([{ clubId, platform }])}>
            {pick(CLUB.askButton, lang)}
          </a>
        </p>
        <p className="muted">
          <small>{pick(CLUB.askNote, lang)}</small>
        </p>
      </section>
      <p>
        <a href="/">{pick(CLUB.back, lang)}</a>
        {" · "}
        <span className="muted">
          {formatUnix(Math.floor(Date.now() / 1000))} ({pick(CLUB.loaded, lang)})
        </span>
      </p>
    </main>
  );
}
