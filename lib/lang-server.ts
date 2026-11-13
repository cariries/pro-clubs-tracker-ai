// Reads the visitor's language on the server (from the cookie). Kept apart from lib/i18n.ts so the pure helpers stay
// importable from tests and client code without pulling in next/headers.
import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, type Lang } from "./i18n";

export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}
