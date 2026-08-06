import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

export default async function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-[12px] bg-[var(--color-canvas)] p-[32px] shadow-[var(--shadow-panel)] border border-[var(--color-hairline)]">
          {children}
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
