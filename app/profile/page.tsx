import { auth, authConfigured, signIn, signOut } from "@/auth";

// Depends on the request's cookies, so never prerender.
export const dynamic = "force-dynamic";

// Temporary bilingual labels (English / 粵語 side by side). Replaced by next-intl in M6.
export default async function ProfilePage() {
  if (!authConfigured()) {
    return (
      <main>
        <h1>Profile / 個人檔案</h1>
        <p>
          Login is not configured yet. Set DATABASE_URL, AUTH_SECRET, AUTH_DISCORD_ID and AUTH_DISCORD_SECRET
          (see .env.example).
        </p>
        <p>登入功能尚未設定。請設定 DATABASE_URL、AUTH_SECRET、AUTH_DISCORD_ID 同 AUTH_DISCORD_SECRET(參考 .env.example)。</p>
      </main>
    );
  }

  const session = await auth();

  if (!session?.user) {
    return (
      <main>
        <h1>Profile / 個人檔案</h1>
        <form
          action={async () => {
            "use server";
            await signIn("discord", { redirectTo: "/profile" });
          }}
        >
          <button type="submit">Sign in with Discord / 用 Discord 登入</button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1>Profile / 個人檔案</h1>
      <p>
        {session.user.name ?? "(no name)"} {session.user.email ? `· ${session.user.email}` : ""}
      </p>
      <p>
        <small>User id: {session.user.id}</small>
      </p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit">Sign out / 登出</button>
      </form>
    </main>
  );
}
