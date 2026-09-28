"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AuthShell } from "../../components/auth-shell";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError("");
    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
      return;
    }
    if (!email.trim()) {
      setError("Enter the email address you sign in with.");
      return;
    }
    setLoading(true);
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${siteUrl}/auth/callback?next=/update-password`
      });
      if (error) throw error;
      // Shown whether or not the address has an account, so this page cannot be
      // used to probe which emails are registered.
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={sent ? "Check your email" : "Reset your password"}
      subtitle={sent ? "If that address has an account, a reset link is on its way." : "We'll email you a link to set a new password."}
      footer={<>Remembered it? <a className="font-bold text-brand" href="/login">Back to sign in</a></>}
    >
      {sent ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm font-semibold">
          The link expires in one hour. Open it in this browser, on this device.
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-bold text-muted">Email address</span>
            <input
              className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none"
              type="email"
              placeholder="you@firm.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>

          {error && <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 font-semibold">{error}</p>}

          <button className="h-11 rounded-lg bg-brand font-bold text-white disabled:opacity-60" onClick={submit} disabled={loading}>
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </div>
      )}
    </AuthShell>
  );
}
