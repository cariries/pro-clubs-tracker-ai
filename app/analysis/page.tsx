import { auth, authConfigured, signIn } from "@/auth";
import { parseAskClubs, type ClubInfo } from "@/lib/ask-clubs";
import { MAX_CLUBS } from "@/lib/club-compare";
import { describeProvider } from "@/lib/llm";
import { readClubCache } from "@/lib/club-cache-db";
import { getLang } from "@/lib/lang-server";
import { pick } from "@/lib/i18n";
import { ASK } from "@/lib/ui-text";
import AnalysisClient from "./AnalysisClient";

export const dynamic = "force-dynamic";

/** Name and data age for the chosen clubs, read from the shared cache only (a database read; this never calls EA). */
async function clubInfos(clubs: ReturnType<typeof parseAskClubs>): Promise<Record<string, ClubInfo>> {
  const out: Record<string, ClubInfo> = {};
  if (!process.env.DATABASE_URL) return out;
  for (const c of clubs) {
    try {
      const row = await readClubCache(c.clubId, c.platform);
      if (row) out[`${c.clubId}.${c.platform}`] = { name: row.capture.summary.clubName ?? null, fetchedAt: row.fetchedAt.toISOString() };
    } catch {
      /* a name and an age are niceties; the page works without them */
    }
  }
  return out;
}

// One language per page, chosen by the visitor (see lib/i18n.ts).
// The chosen clubs are in the URL (?clubs=914493.common-gen5,...), so signing in keeps them.
export default async function AnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lang = await getLang();
  const sp = await searchParams;
  const clubs = parseAskClubs(sp.clubs);
  if (!authConfigured()) {
    return (
      <main>
        <h1>{pick(ASK.title, lang)}</h1>
        <p>{pick(ASK.loginNotConfigured, lang)}</p>
      </main>
    );
  }
  const session = await auth();
  if (!session?.user?.id) {
    const back = clubs.length > 0 ? `/analysis?clubs=${encodeURIComponent(clubs.map((c) => `${c.clubId}.${c.platform}`).join(","))}` : "/analysis";
    return (
      <main>
        <h1>{pick(ASK.title, lang)}</h1>
        <p>{pick(ASK.signInTitle, lang)}</p>
        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: back });
          }}
        >
          <button type="submit">{pick(ASK.signIn, lang)}</button>
        </form>
      </main>
    );
  }
  return <AnalysisClient initialClubs={clubs} infos={await clubInfos(clubs)} provider={describeProvider()} max={MAX_CLUBS} lang={lang} />;
}
