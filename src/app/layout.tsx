import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { IBM_Plex_Sans_Thai } from "next/font/google";

import "./globals.css";

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  display: "swap",
  subsets: ["latin", "thai"],
  variable: "--font-sans",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Wazuh Dashboard",
  description: "Operational security monitoring dashboard",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={ibmPlexSansThai.variable}>
      <body>{children}</body>
    </html>
  );
}
