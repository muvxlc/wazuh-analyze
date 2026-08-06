"use client";

import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { useState } from "react";

export default function InvitePage() {
  const params = useParams();
  const token = params.token as string;
  const t = useTranslations("auth.invite");
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const displayName = formData.get("displayName") as string;
      const password = formData.get("password") as string;

      const res = await fetch(`/api/invites/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, password }),
      });

      if (!res.ok) {
        setError(t("error"));
        return;
      }

      router.push("/dashboard");
    } catch {
      setError(t("error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="mb-6 text-[22px] font-medium leading-[1.2]">{t("title")}</h1>
      
      {error && (
        <div className="mb-4 rounded-[6px] bg-[#ff2201] p-[8px] text-[13px] text-white">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="displayName" className="text-[13px] font-medium">{t("displayName")}</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            className="rounded-[6px] border border-[var(--color-hairline)] px-[12px] py-[8px] text-[16px] outline-none focus:border-[var(--color-ink)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-[13px] font-medium">{t("password")}</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="rounded-[6px] border border-[var(--color-hairline)] px-[12px] py-[8px] text-[16px] outline-none focus:border-[var(--color-ink)]"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-[6px] bg-[var(--color-primary)] px-[16px] py-[8px] text-[14px] font-medium text-[var(--color-ink)] disabled:opacity-50"
        >
          {t("submit")}
        </button>
      </form>
    </div>
  );
}
