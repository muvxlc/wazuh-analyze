"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function LocaleSwitcher({ currentLocale }: { currentLocale?: string }) {
  const t = useTranslations("locale");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleLocaleChange = async (newLocale: string) => {
    const res = await fetch("/api/preferences/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: newLocale }),
    });
    if (!res.ok) {
      alert("Failed to update locale");
      return;
    }
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="flex gap-2 text-[13px]">
      <button
        type="button"
        onClick={() => handleLocaleChange("en")}
        disabled={isPending}
        className={`link-button text-[13px] ${currentLocale === "en" ? "font-bold underline" : ""}`}
      >
        {t("en")}
      </button>
      <span>/</span>
      <button
        type="button"
        onClick={() => handleLocaleChange("th")}
        disabled={isPending}
        className={`link-button text-[13px] ${currentLocale === "th" ? "font-bold underline" : ""}`}
      >
        {t("th")}
      </button>
    </div>
  );
}
