import type { ReactNode } from "react";
import SiteHeader from "@/components/SiteHeader";
import { getLang } from "@/lib/lang-server";
import { COMMON, htmlLang, pick } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata() {
  const lang = await getLang();
  return { title: pick(COMMON.brand, lang), description: pick(COMMON.metaDescription, lang) };
}

// Every page shows one language, chosen by the visitor (cookie, Cantonese by default). Reading the cookie makes the
// layout dynamic, which every page here already is.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={htmlLang(lang)}>
      <body>
        <SiteHeader lang={lang} />
        {children}
      </body>
    </html>
  );
}
