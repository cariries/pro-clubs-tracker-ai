import type { ReactNode } from "react";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata = {
  title: "FC 2X Pro Club Tracker",
  description: "Search EA Sports FC Pro Clubs clubs and see their statistics. 搜尋 EA Sports FC Pro Clubs 球會並查看統計。",
};

// The page language is mixed on purpose (English and Cantonese side by side) until the i18n framework arrives.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
