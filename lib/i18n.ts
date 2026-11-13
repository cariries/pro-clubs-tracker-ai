// A small in-repo i18n (no package): the language lives in a cookie, Cantonese is the default, and every page shows ONE
// language. Pure functions here; reading the cookie on the server is in lib/lang-server.ts.
export const LANGS = ["zh", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "zh";
export const LANG_COOKIE = "lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

/** Anything that is not exactly a supported language falls back to the default. */
export const parseLang = (v: unknown): Lang => (isLang(v) ? v : DEFAULT_LANG);

/** The value for <html lang>. */
export const htmlLang = (l: Lang): string => (l === "zh" ? "zh-HK" : "en");

export interface Bi {
  en: string;
  zh: string;
}

/** One side of a bilingual pair. */
export const pick = (b: Bi, l: Lang): string => b[l];

/** Fills {name} placeholders. A placeholder with no value is left visible so a mistake shows up in tests, not as blank text. */
export function fill(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
}

/** The other language, for the header switch. */
export const otherLang = (l: Lang): Lang => (l === "zh" ? "en" : "zh");

/**
 * Where to send the visitor after they switch language: back to the page they were on. The Referer header is
 * untrusted, so it is used only if it is on this same site; otherwise (or if missing or junk) go home.
 */
export function safeBack(referer: string | null | undefined, siteOrigin: string): string {
  if (!referer) return "/";
  try {
    const u = new URL(referer);
    if (u.origin !== siteOrigin) return "/";
    const path = `${u.pathname}${u.search}`;
    // Never bounce back onto the switch route itself (that would loop), and only allow plain site paths.
    if (!path.startsWith("/") || path.startsWith("//") || u.pathname === "/lang") return "/";
    return path;
  } catch {
    return "/";
  }
}

/** The UI strings shared by several pages. Page-specific strings live in lib/ui-text.ts. */
export const COMMON = {
  brand: { en: "ProClubs Tracker", zh: "ProClubs 速查" },
  metaDescription: { en: "Search EA Sports FC Pro Clubs clubs and see their statistics.", zh: "搜尋 EA Sports FC Pro Clubs 球會並查看統計。" },
  navSearch: { en: "Search", zh: "搜尋" },
  navAsk: { en: "Ask AI", zh: "問 AI" },
  navLabel: { en: "Main navigation", zh: "主要導覽" },
  switchTo: { en: "中文", zh: "English" },
  switchLabel: { en: "Switch to Chinese", zh: "Switch to English" },
  platformGen5: { en: "PlayStation / Xbox / PC", zh: "PlayStation / Xbox / PC" },
  platformNx: { en: "Nintendo Switch", zh: "Nintendo Switch" },
  games: { en: "games", zh: "場" },
  club: { en: "Club", zh: "球會" },
} satisfies Record<string, Bi>;

/** Initials for the avatar fallback: one character for a Chinese name, two letters otherwise. */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const display = (name ?? "").trim() || (email ?? "").trim();
  if (display === "") return "?";
  if (/^\p{Script=Han}/u.test(display)) return Array.from(display)[0];
  return display.slice(0, 2).toUpperCase();
}

/** The account menu's text. */
export const ACCOUNT = {
  signIn: { en: "Sign in", zh: "登入" },
  menuLabel: { en: "Account menu", zh: "帳戶選單" },
  signedInAs: { en: "Signed in as", zh: "已登入為" },
  myAccount: { en: "My account", zh: "我嘅帳戶" },
  askAi: { en: "Ask AI", zh: "問 AI" },
  signOut: { en: "Sign out", zh: "登出" },
  noName: { en: "(no name)", zh: "(未有名稱)" },
} satisfies Record<string, Bi>;
