// Bilingual wording for the public pages. Pure, so it is tested. Messages never include what the visitor typed
// (it is shown separately by the page, escaped by React), and never include provider or database detail.
import type { Bi } from "./i18n";

export type HomeError = "too_short" | "too_long" | "bad_characters" | "bad_platform" | "none" | "busy" | "blocked" | "ea" | "unavailable";

const HOME_ERRORS: Record<HomeError, Bi> = {
  too_short: { en: "Type at least 2 characters of the club name.", zh: "請輸入球會名稱至少 2 個字。" },
  too_long: { en: "That club name is too long (50 characters at most).", zh: "球會名稱太長(最多 50 個字)。" },
  bad_characters: { en: "The club name contains characters that are not allowed.", zh: "球會名稱包含唔容許嘅字元。" },
  bad_platform: { en: "Choose a platform from the list.", zh: "請從清單揀選平台。" },
  none: { en: "No club found with that name on this platform. Check the spelling, or try the other platform.", zh: "喺呢個平台搵唔到呢個名稱嘅球會。請檢查拼寫,或者試另一個平台。" },
  busy: { en: "Too many searches right now. Please wait {retry} and try again.", zh: "而家搜尋太頻密,請等 {retry} 後再試。" },
  blocked: { en: "EA is not answering requests at the moment, so searches are paused for a few minutes. Please try again later.", zh: "EA 暫時冇回應請求,所以搜尋暫停幾分鐘。請稍後再試。" },
  ea: { en: "EA did not respond properly. Please try again in a moment.", zh: "EA 冇正常回應,請稍後再試。" },
  unavailable: { en: "The service is not available right now. Please try again later.", zh: "服務暫時用唔到,請稍後再試。" },
};

export const isHomeError = (v: string): v is HomeError => Object.hasOwn(HOME_ERRORS, v);

/** "45 seconds" / "3 minutes" in both languages, from a number of seconds. */
export function waitText(sec: number): Bi {
  const s = Math.max(1, Math.round(sec));
  if (s < 90) return { en: `${s} second${s === 1 ? "" : "s"}`, zh: `${s} 秒` };
  const m = Math.ceil(s / 60);
  return { en: `${m} minutes`, zh: `${m} 分鐘` };
}

/** What the home page shows for ?error=... (and ?retry=seconds). Unknown codes show nothing, never raw text. */
export function describeHomeError(code: string, retry?: string): Bi | null {
  if (!isHomeError(code)) return null;
  const base = HOME_ERRORS[code];
  if (code !== "busy") return base;
  const n = Number(retry);
  const w = waitText(Number.isFinite(n) && n > 0 && n < 100_000 ? n : 60);
  return { en: base.en.replace("{retry}", w.en), zh: base.zh.replace("{retry}", w.zh) };
}
