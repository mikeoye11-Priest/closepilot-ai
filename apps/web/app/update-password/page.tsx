"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AuthShell } from "../../components/auth-shell";

const MIN_LENGTH = 8;

/**
 * Supabase is the authority on password rules — minimum length and leaked-password
 * checks are project settings, so the client check below is a fast first pass, not
 * the guarantee. These map the responses worth explaining in our own words.
 */
function passwordChangeError(err: unknown): string {
  const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
  const message = err instanceof Error ? err.message : "";
  const text = `${code} ${message}`.toLowerCase();

  // Raised when "Secure password change" is on and the session is no longer recent.
  if (text.includes("reauthentication")) {
    return "For security, sign in again before changing your password.";
  }
  if (text.includes("pwned") || text.includes("leaked")) {
    return "That password has appeared in a known data breach. Choose a different one.";
  }
  if (text.includes("should be at least") || text.includes("password_too_short")) {
    return message || `Use at least ${MIN_LENGTH} characters.`;
  }
  if (text.includes("same_password") || text.includes("should be different")) {
    return "That is already your current password. Choose a different one.";
  }
  return message || "Something went wrong.";
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  // /auth/callback exchanges the emailed code for a session before redirecting
  // here. No session means the link was expired, reused, or opened directly.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setChecking(false);
    });
  }, []);

  const submit = async () => {
    setError("");
    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
      return;
    }
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // A reset is often a response to a compromise, so drop every other live
      // session for this user. Best-effort: the password has already changed,
      // and failing here should not tell the user otherwise.
      await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);

      setDone(true);
    } catch (err: unknown) {
      setError(passwordChangeError(err));
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <AuthShell title="One moment" subtitle="Checking your reset link.">
        <p className="text-sm text-muted">Verifying...</p>
      </AuthShell>
    );
  }

  if (!hasSession) {
    return (
      <AuthShell
        title="That link has expired"
        subtitle="Reset links are single-use and last one hour."
        footer={<><a className="font-bold text-brand" href="/forgot-password">Request a new link</a></>}
      >
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 font-semibold">
          Reset links can only be used once, so open the newest one you were sent.
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={done ? "Password updated" : "Set a new password"}
      subtitle={done ? "You're signed in with your new password." : "Choose something you don't use anywhere else."}
      footer={done ? <a className="font-bold text-brand" href="/">Go to your workspace</a> : undefined}
    >
      {done ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm font-semibold">
          Your password has been changed.
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-bold text-muted">New password</span>
            <input
              className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span className="text-xs text-muted">At least {MIN_LENGTH} characters.</span>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-bold text-muted">Confirm new password</span>
            <input
              className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none"
              type="password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>

          {error && <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 font-semibold">{error}</p>}

          <button className="h-11 rounded-lg bg-brand font-bold text-white disabled:opacity-60" onClick={submit} disabled={loading}>
            {loading ? "Saving..." : "Save new password"}
          </button>
        </div>
      )}
    </AuthShell>
  );
}
