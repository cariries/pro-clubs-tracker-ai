import { PUBLIC_PLATFORMS, SEARCH_NAME_MAX, isPublicPlatform } from "@/lib/public-clubs";
import { describeHomeError } from "@/lib/public-text";
import { getLang } from "@/lib/lang-server";
import { pick } from "@/lib/i18n";
import { HOME } from "@/lib/ui-text";

export const dynamic = "force-dynamic";

// Public: no login. A search box for a club name, in the visitor's language.
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const val = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const error = describeHomeError(val("error"), val("retry"));
  const name = val("name").slice(0, SEARCH_NAME_MAX);
  const platform = isPublicPlatform(val("platform")) ? val("platform") : "common-gen5";

  return (
    <main>
      <section className="hero">
        <h1>{pick(HOME.title, lang)}</h1>
        <p className="muted">{pick(HOME.lead, lang)}</p>
        <form className="search" action="/search" method="get">
          <input type="text" name="name" defaultValue={name} placeholder={pick(HOME.nameLabel, lang)} aria-label={pick(HOME.nameLabel, lang)} minLength={2} maxLength={SEARCH_NAME_MAX} required autoFocus />
          <select name="platform" defaultValue={platform} aria-label={pick(HOME.platformLabel, lang)}>
            {PUBLIC_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {pick(p === "common-gen5" ? HOME.platformGen5 : HOME.platformNx, lang)}
              </option>
            ))}
          </select>
          <button type="submit">{pick(HOME.search, lang)}</button>
        </form>
        {error && (
          <div className="notice error" role="alert">
            {pick(error, lang)}
          </div>
        )}
      </section>

      <section className="card">
        <h2>{pick(HOME.whatTitle, lang)}</h2>
        <ul>
          <li>{pick(HOME.what1, lang)}</li>
          <li>
            <a href="/analysis">{pick(HOME.what2, lang)}</a>
          </li>
        </ul>
        <p className="muted">
          <small>{pick(HOME.note, lang)}</small>
        </p>
      </section>
    </main>
  );
}
