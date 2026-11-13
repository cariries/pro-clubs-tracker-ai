import { auth, authConfigured, signIn } from "@/auth";
import { getLang } from "@/lib/lang-server";
import { pick } from "@/lib/i18n";
import { PROFILE } from "@/lib/ui-text";

// Depends on the request's cookies, so never prerender.
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const lang = await getLang();
  if (!authConfigured()) {
    return (
      <main>
        <h1>{pick(PROFILE.title, lang)}</h1>
        <p>{pick(PROFILE.notConfigured, lang)}</p>
      </main>
    );
  }

  const session = await auth();

  if (!session?.user) {
    return (
      <main>
        <h1>{pick(PROFILE.title, lang)}</h1>
        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: "/profile" });
          }}
        >
          <button type="submit">{pick(PROFILE.signIn, lang)}</button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1>{pick(PROFILE.title, lang)}</h1>
      <p>
        {session.user.name ?? pick(PROFILE.noName, lang)} {session.user.email ? `· ${session.user.email}` : ""}
      </p>
      <p>
        <small>
          {pick(PROFILE.userId, lang)}: {session.user.id}
        </small>
      </p>
    </main>
  );
}
