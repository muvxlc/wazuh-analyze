import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { createDatabase } from "../server/db/client";
import { loadConfig } from "../server/config";
import { currentUser } from "../server/auth/current-user";

export default getRequestConfig(async () => {
  let locale = "en";

  try {
    const cookieStore = await cookies();
    const config = loadConfig(process.env);
    const { db, pool } = createDatabase(config.databaseUrl);
    
    try {
      const user = await currentUser(db);
      if (user) {
        locale = user.locale;
      } else {
        const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
        if (cookieLocale === "en" || cookieLocale === "th") {
          locale = cookieLocale;
        }
      }
    } finally {
      await pool.end();
    }
  } catch {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
    if (cookieLocale === "en" || cookieLocale === "th") {
      locale = cookieLocale;
    }
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
