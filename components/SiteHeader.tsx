import { auth, authConfigured, signIn, signOut } from "@/auth";
import { ACCOUNT, COMMON, htmlLang, otherLang, pick, type Lang } from "@/lib/i18n";
import AccountMenu from "./AccountMenu";

// The header on every page, in the visitor's language. Search and club pages are public; Ask AI needs a login.
// Left: the name and the two main links. Top right, side by side: the language switch and either a "Sign in" link
// (signed out) or the avatar menu with Sign out (signed in).
export default async function SiteHeader({ lang }: { lang: Lang }) {
  const other = otherLang(lang);
  // Reading the session is cheap (a signed cookie, no database). Skipped when login is not configured.
  const session = authConfigured() ? await auth().catch(() => null) : null;
  const user = session?.user;
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }
  async function signInAction() {
    "use server";
    await signIn("discord", { redirectTo: "/" });
  }
  return (
    <header className="site-header">
      <nav aria-label={pick(COMMON.navLabel, lang)}>
        <a className="brand" href="/">
          {pick(COMMON.brand, lang)}
        </a>
        <div className="header-links">
          <a href="/">{pick(COMMON.navSearch, lang)}</a>
          <a href="/analysis">{pick(COMMON.navAsk, lang)}</a>
        </div>
        <div className="header-right">
          <a className="lang-switch" href={`/lang?to=${other}`} lang={htmlLang(other)} aria-label={pick(COMMON.switchLabel, lang)}>
            {pick(COMMON.switchTo, lang)}
          </a>
          {user ? (
            <AccountMenu lang={lang} user={{ name: user.name ?? null, email: user.email ?? null, image: user.image ?? null }} signOutAction={signOutAction} />
          ) : authConfigured() ? (
            <form action={signInAction}>
              <button type="submit" className="signin-link">
                {pick(ACCOUNT.signIn, lang)}
              </button>
            </form>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
