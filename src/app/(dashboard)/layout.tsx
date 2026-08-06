import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { createDatabase } from "../../server/db/client";
import { loadConfig } from "../../server/config";
import { currentUser } from "../../server/auth/current-user";
import { AppShell } from "../../components/shell/app-shell";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const messages = await getMessages();
  const config = loadConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  
  try {
    const user = await currentUser(db);
    if (!user) {
      redirect("/login");
    }

    return (
      <NextIntlClientProvider messages={messages}>
        <AppShell user={user}>
          {children}
        </AppShell>
      </NextIntlClientProvider>
    );
  } finally {
    await pool.end();
  }
}
