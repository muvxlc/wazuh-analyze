import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

export default async function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas-soft)] p-4">
        <div className="panel w-full max-w-md p-[32px]">
          {children}
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
