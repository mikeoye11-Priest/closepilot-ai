"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { AuthShell } from "../../components/auth-shell";
import { authErrorMessage } from "@/lib/auth-errors";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firmName, setFirmName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState("");

  // /auth/callback sends failed or expired reset links back here with ?error=.
  // Read from location rather than useSearchParams to avoid a Suspense boundary.
  // The value is a fixed code resolved to our own copy — never rendered raw, so
  // a crafted link cannot put its own words on this page.
  useEffect(() => {
    const message = authErrorMessage(new URLSearchParams(window.location.search).get("error"));
    if (message) setError(message);
  }, []);

  const submit = async () => {
    setError("");
    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/";
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { firm_name: firmName } }
        });
        if (error) throw error;
        setDone("Check your email to confirm your account, then sign in.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={mode === "login" ? "Welcome back" : "Create your account"}
      subtitle={mode === "login" ? "Sign in to your practice workspace." : "Set up your ClosePilot practice workspace."}
      footer={
        <>
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button className="font-bold text-brand" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setDone(""); }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </>
      }
    >
      {done ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm font-semibold">{done}</div>
      ) : (
        <div className="grid gap-4">
          {mode === "signup" && (
            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-muted">Firm or company name</span>
              <input className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none" placeholder="Northbridge Advisory LLP" value={firmName} onChange={(e) => setFirmName(e.target.value)} />
            </label>
          )}
          <label className="grid gap-1.5">
            <span className="text-sm font-bold text-muted">Email address</span>
            <input className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none" type="email" placeholder="you@firm.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-muted">Password</span>
              {mode === "login" && <a className="text-sm font-bold text-brand" href="/forgot-password">Forgot password?</a>}
            </div>
            <input className="h-11 rounded-lg border border-line px-3 focus:border-brand focus:outline-none" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          </label>

          {error && <p className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 font-semibold">{error}</p>}

          <button className="h-11 rounded-lg bg-brand font-bold text-white disabled:opacity-60" onClick={submit} disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </div>
      )}
    </AuthShell>
  );
}
