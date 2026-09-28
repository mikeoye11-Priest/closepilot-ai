"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { AuthShell } from "../../components/auth-shell";



export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError("");
    if (!email.trim()) {
      setError("Enter the email address you sign in with.");
      return;
    }
    setLoading(true);
    try {
      // Sent via our own route rather than straight to Supabase, so a send
      // failure is reported where error tracking runs. Called from the browser
      // this failed silently for an hour: the visitor saw "check your email"
      // and nobody else ever knew.
      const res = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.error ?? "Something went wrong sending the reset email. Please try again.");
        return;
      }

      // Shown whether or not the address has an account, so this page cannot be
      // used to probe which emails are registered.
      setSent(true);
    } catch {
      setError("Could not reach ClosePilot. Check your connection and try again.");
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
          The link expires in one hour and can only be used once. You can open it on any device.
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
