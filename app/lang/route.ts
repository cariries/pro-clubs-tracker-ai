import { NextResponse } from "next/server";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLang, safeBack } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The header's language switch: set the cookie, then go back to the page the visitor was on. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  const res = NextResponse.redirect(new URL(safeBack(req.headers.get("referer"), url.origin), url), 303);
  if (isLang(to)) res.cookies.set(LANG_COOKIE, to, { path: "/", maxAge: LANG_COOKIE_MAX_AGE, sameSite: "lax", httpOnly: false });
  return res;
}
