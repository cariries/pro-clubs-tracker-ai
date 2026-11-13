import { PUBLIC_PLATFORMS, SEARCH_NAME_MAX, isPublicPlatform } from "@/lib/public-clubs";
import { describeHomeError } from "@/lib/public-text";

export const dynamic = "force-dynamic";

// Public: no login. A search box for a club name. Labels are English and Cantonese side by side until M6.
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const error = describeHomeError(pick("error"), pick("retry"));
  const name = pick("name").slice(0, SEARCH_NAME_MAX);
  const platform = isPublicPlatform(pick("platform")) ? pick("platform") : "common-gen5";

  return (
    <main>
      <section className="hero">
        <h1>Find a Pro Clubs club / 搵 Pro Clubs 球會</h1>
        <p className="muted">
          See a club&apos;s record and its members&apos; statistics from EA. No login needed. / 查看球會戰績同球員統計,毋須登入。
        </p>
        <form className="search" action="/search" method="get">
          <input type="text" name="name" defaultValue={name} placeholder="Club name / 球會名稱" aria-label="Club name / 球會名稱" minLength={2} maxLength={SEARCH_NAME_MAX} required autoFocus />
          <select name="platform" defaultValue={platform} aria-label="Platform / 平台">
            {PUBLIC_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p === "common-gen5" ? "PlayStation / Xbox / PC (current gen)" : "Nintendo Switch"}
              </option>
            ))}
          </select>
          <button type="submit">Search / 搜尋</button>
        </form>
        {error && (
          <div className="notice error" role="alert" style={{ maxWidth: 560, margin: "12px auto", textAlign: "left" }}>
            {error.en}
            <br />
            {error.zh}
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>What you can do / 可以做啲咩</h2>
        <ul>
          <li>Search a club by name and see its statistics and members. / 用名稱搜尋球會,睇佢嘅統計同球員。</li>
          <li>
            Sign in to <a href="/analysis">ask the AI</a> about one club, or compare 2 to 4 clubs. / 登入後可以<a href="/analysis">問 AI</a>:睇一個球會,或者比較 2 至 4 個球會。
          </li>
        </ul>
        <p className="muted">
          <small>Data comes from EA and can be out of date; each page shows when a club last played. Club data is kept for about 15 minutes and shared, so a repeat look is quick. / 數據來自 EA,可能唔係最新;每頁都會顯示球會最後一場賽事時間。球會資料會保留約 15 分鐘並供大家共用,所以重複查看會比較快。</small>
        </p>
      </section>
    </main>
  );
}
