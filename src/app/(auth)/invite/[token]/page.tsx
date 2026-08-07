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
      <h1>{t("title")}</h1>
      
      {error && (
        <div className="status-error mb-4">
          {error}
        </div>
      )}

      <form suppressHydrationWarning onSubmit={handleSubmit} className="form-stack">
        <div className="form-field">
          <label htmlFor="displayName" className="text-[13px] font-medium">{t("displayName")}</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            className="auth-input"
          />
        </div>

        <div className="form-field">
          <label htmlFor="password" className="text-[13px] font-medium">{t("password")}</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="auth-input"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2"
        >
          {t("submit")}
        </button>
      </form>
    </div>
  );
}
