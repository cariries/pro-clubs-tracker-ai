"use client";

import { useEffect, useRef, useState } from "react";
import { ACCOUNT, initialsOf, pick, type Lang } from "@/lib/i18n";

// The signed-in user's avatar at the top right, opening a small menu with their name, links and Sign out. The
// sign-out itself is a server action passed in by the header, so no auth code runs in the browser. Closes on an outside
// click, on Escape, and when a link is chosen.
export default function AccountMenu({
  lang,
  user,
  signOutAction,
}: {
  lang: Lang;
  user: { name: string | null; email: string | null; image: string | null };
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = user.name?.trim() || user.email || pick(ACCOUNT.noName, lang);
  return (
    <div className="account" ref={box}>
      <button type="button" className="avatar-btn" aria-haspopup="menu" aria-expanded={open} aria-label={pick(ACCOUNT.menuLabel, lang)} onClick={() => setOpen((v) => !v)}>
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" width={32} height={32} referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden>{initialsOf(user.name, user.email)}</span>
        )}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <small className="muted">{pick(ACCOUNT.signedInAs, lang)}</small>
            <div className="menu-name">{shown}</div>
            {user.email && user.name && <div className="muted menu-email">{user.email}</div>}
          </div>
          <a role="menuitem" href="/analysis" onClick={() => setOpen(false)}>
            {pick(ACCOUNT.askAi, lang)}
          </a>
          <a role="menuitem" href="/profile" onClick={() => setOpen(false)}>
            {pick(ACCOUNT.myAccount, lang)}
          </a>
          <form action={signOutAction}>
            <button type="submit" role="menuitem" className="menu-signout">
              {pick(ACCOUNT.signOut, lang)}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
