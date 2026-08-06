"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const t = useTranslations("auth.login");
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const email = formData.get("email") as string;
      const password = formData.get("password") as string;

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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

      <form onSubmit={handleSubmit} className="form-stack" suppressHydrationWarning>
        <div className="form-field">
          <label htmlFor="email" className="text-[13px] font-medium">{t("email")}</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="auth-input"
            suppressHydrationWarning
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
            suppressHydrationWarning
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
