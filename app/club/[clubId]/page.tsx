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

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const pct = (v: number | null) => (v === null ? "–" : `${v}%`);
const n = (v: number | null) => (v === null ? "–" : String(v));

// Public: no login. The club's record and every member, fetched live from EA (cached 5 minutes), nothing stored.
export default async function ClubPage({ params, searchParams }: { params: Promise<{ clubId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
    ...(club.thin ? [{ en: `This club has only ${rec?.games ?? 0} league games, so its rates are not very reliable.`, zh: `呢個球會只有 ${rec?.games ?? 0} 場聯賽,所以比率未必好可靠。` }] : []),
    ...(club.dataAgeDays !== null && club.dataAgeDays > 14
      ? [describeWarning({ code: "stale_data", club: name, days: club.dataAgeDays })]
      : []),
    ...(club.failedParts.length > 0 ? [{ en: "Some data could not be loaded from EA, so parts of this page may be missing.", zh: "部分資料未能從 EA 載入,所以本頁部分內容可能欠缺。" }] : []),
  ];

  return (
    <main>
      <h1>{name}</h1>
      <p className="muted">
        {platform === "common-gen5" ? "PlayStation / Xbox / PC" : "Nintendo Switch"} · Club ID / 球會編號 {clubId}
        {club.newestMatchAt ? <> · newest EA match / EA 最新賽事 {club.newestMatchAt}</> : null}
      </p>
      {warnings.map((w, i) => (
        <div className="notice" key={i}>
          {w.en}
          <br />
          {w.zh}
        </div>
      ))}

      {rec ? (
        <section>
          <h2>Club record / 球會戰績</h2>
          <div className="stats">
            <Stat k="Played / 場數" v={n(rec.games)} />
            <Stat k="Win / 勝" v={n(rec.wins)} />
            <Stat k="Draw / 和" v={n(rec.ties)} />
            <Stat k="Loss / 負" v={n(rec.losses)} />
            <Stat k="Win rate / 勝率" v={pct(club.winRate)} />
            <Stat k="Goals for per game / 場均入球" v={n(club.goalsForPerGame)} />
            <Stat k="Goals against per game / 場均失球" v={n(club.goalsAgainstPerGame)} />
            <Stat k="Skill rating / 技術評分" v={n(p.skillRating)} />
          </div>
        </section>
      ) : (
        <div className="notice">
          No record is available for this club. / 呢個球會冇可用戰績。
        </div>
      )}

      <section>
        <h2>Members / 球員 ({club.members.length})</h2>
        {club.members.length === 0 ? (
          <p className="muted">No member statistics available. / 冇可用嘅球員統計。</p>
        ) : (
          <div className="card tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Name / 名</th>
                  <th>Pos / 位置</th>
                  <th>GP / 場</th>
                  <th>G / 入球</th>
                  <th>A / 助攻</th>
                  <th>G per game / 場均入球</th>
                  <th>Rating / 評分</th>
                  <th>Pass % / 傳球</th>
                  <th>Shot % / 射門</th>
                  <th>Tackle % / 搶截</th>
                  <th>MOTM</th>
                  <th>Career GP / 生涯場</th>
                  <th>Career G / 生涯入球</th>
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
          <small>* fewer than 5 games, so rates are not reliable / 少於 5 場,比率未必可靠。Crossing and dribbling are not available. / 未有傳中同盤帶數據。</small>
        </p>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Want to go further? / 想再深入?</h3>
        <p>
          <a className="button" href={askPath([{ clubId, platform }])}>
            Ask AI about this club / 問 AI 關於呢個球會
          </a>
        </p>
        <p className="muted">
          <small>Sign in required. On the next page you can add up to 3 more clubs to compare. / 需要登入。下一頁可以再加最多 3 個球會作比較。</small>
        </p>
      </section>
      <p>
        <a href="/">← Search another club / 搜尋其他球會</a>
        {" · "}
        <span className="muted">
          {formatUnix(Math.floor(Date.now() / 1000))} (page loaded / 載入時間)
        </span>
      </p>
    </main>
  );
}
